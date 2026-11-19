// Command harness is the Go side of the SelfAuth conformance driver
// (conformance/CONFORMANCE.md). It is test-only and is not part of the server.
//
// The conformance runner is written in TypeScript and drives an application
// over HTTP. This program hosts one isolated application instance per
// conformance case, each with its own in-memory store, manual clock, mailer and
// log sink, and exposes control endpoints for the views a case needs but a real
// client does not have: time, the last email, storage, security events and logs.
//
//	POST   /__control/instances                  create an instance (config, environment, given)
//	DELETE /__control/instances/{id}             close it
//	POST   /__control/instances/{id}/advance     {"ms": n}
//	GET    /__control/instances/{id}/email?to=   the last email to an address
//	GET    /__control/instances/{id}/storage?entity=
//	POST   /__control/instances/{id}/mutate      {"entity", "where", "set"}
//	GET    /__control/instances/{id}/events
//	GET    /__control/instances/{id}/logs
//	GET    /__control/instances/{id}/list-filtered
//	ANY    /i/{id}/...                           the application itself
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"example.com/app/internal/app"
	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/ginauth"
	"example.com/app/internal/store/sqlstore"
	"github.com/gin-gonic/gin"
)

const baseURL = "https://app.example.test"

// testCSRFSecret is the fixed CSRF secret of test instances.
var testCSRFSecret = func() []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = 7
	}
	return b
}()

type given struct {
	User     string   `json:"user"`
	Email    string   `json:"email"`
	Password string   `json:"password"`
	State    string   `json:"state"`
	Roles    []string `json:"roles"`
	Resource *struct {
		Type  string `json:"type"`
		ID    string `json:"id"`
		Owner string `json:"owner"`
	} `json:"resource"`
}

type createRequest struct {
	// Store is "memory" (default), "postgres" (needs TEST_DATABASE_URL), "sqlite", "mysql" (needs TEST_MYSQL_URL) or "mongodb" (needs TEST_MONGODB_URL).
	Store       string          `json:"store"`
	Config      json.RawMessage `json:"config"`
	Environment string          `json:"environment"`
	Given       []given         `json:"given"`
}

type resource struct{ Type, ID, OwnerID string }

type instance struct {
	handler http.Handler
	clock   *auth.ManualClock
	mailer  *auth.MemoryMailer
	backend backend
	store   auth.Store
	logs    *auth.MemoryLogSink

	mu           sync.Mutex
	resources    []resource
	listFiltered *bool
	fixtures     map[string]map[string]string
}

type server struct {
	mu        sync.Mutex
	instances map[string]*instance
	hashes    sync.Map // password+params -> *hashEntry
}

type hashEntry struct {
	once sync.Once
	hash string
}

func main() {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	s := &server{instances: map[string]*instance{}}
	fmt.Printf("listening %s\n", listener.Addr().String())
	if err := http.Serve(listener, s); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasPrefix(r.URL.Path, "/i/"):
		s.serveInstance(w, r)
	case strings.HasPrefix(r.URL.Path, "/__control/"):
		s.control(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *server) get(id string) *instance {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.instances[id]
}

func (s *server) serveInstance(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/i/")
	id, path, _ := strings.Cut(rest, "/")
	inst := s.get(id)
	if inst == nil {
		http.NotFound(w, r)
		return
	}
	// Strip "/i/{id}" from both the decoded and the raw path.
	prefix := "/i/" + id
	r2 := r.Clone(r.Context())
	r2.URL.Path = "/" + path
	if raw := r.URL.RawPath; raw != "" {
		r2.URL.RawPath = "/" + strings.TrimPrefix(strings.TrimPrefix(raw, prefix), "/")
	}
	r2.RequestURI = r2.URL.RequestURI()
	inst.handler.ServeHTTP(w, r2)
}

func (s *server) control(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/__control/"), "/")
	if len(parts) < 1 || parts[0] != "instances" {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPost {
		s.create(w, r)
		return
	}
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	inst := s.get(parts[1])
	if inst == nil {
		http.NotFound(w, r)
		return
	}
	action := ""
	if len(parts) > 2 {
		action = parts[2]
	}
	switch {
	case action == "" && r.Method == http.MethodDelete:
		s.mu.Lock()
		delete(s.instances, parts[1])
		s.mu.Unlock()
		inst.backend.close()
		writeJSON(w, http.StatusOK, map[string]bool{"closed": true})
	case action == "advance" && r.Method == http.MethodPost:
		var body struct {
			Ms int64 `json:"ms"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		inst.clock.Advance(time.Duration(body.Ms) * time.Millisecond)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case action == "email":
		mail, ok := inst.mailer.LastTo(r.URL.Query().Get("to"))
		if !ok {
			writeJSON(w, http.StatusOK, nil)
			return
		}
		out := map[string]any{"kind": string(mail.Kind)}
		if mail.Token != "" {
			out["token"] = mail.Token
		}
		if mail.Link != "" {
			out["link"] = mail.Link
		}
		writeJSON(w, http.StatusOK, out)
	case action == "storage":
		records, err := inst.backend.inspect(r.Context(), r.URL.Query().Get("entity"))
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, records)
	case action == "mutate" && r.Method == http.MethodPost:
		var body struct {
			Entity string         `json:"entity"`
			Where  map[string]any `json:"where"`
			Set    map[string]any `json:"set"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		if err := inst.backend.mutate(r.Context(), body.Entity, body.Where, body.Set); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case action == "events":
		events, err := inst.backend.events(r.Context())
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, events)
	case action == "logs":
		writeJSON(w, http.StatusOK, inst.logs.Lines())
	case action == "list-filtered":
		inst.mu.Lock()
		v := inst.listFiltered
		inst.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"filtered": v})
	default:
		http.NotFound(w, r)
	}
}

func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	cfg, err := config.Parse(req.Config)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	id := auth.NewID()
	inst, err := s.build(r.Context(), cfg, req)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	s.mu.Lock()
	s.instances[id] = inst
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "fixtures": inst.fixtures})
}

func (s *server) hash(h *auth.PasswordHasher, params config.Hashing, password string) string {
	key := fmt.Sprintf("%d/%d/%d/%s", params.MemoryKiB, params.Iterations, params.Parallelism, password)
	entry, _ := s.hashes.LoadOrStore(key, &hashEntry{})
	e := entry.(*hashEntry)
	e.once.Do(func() { e.hash = h.Hash(password) })
	return e.hash
}

func (s *server) build(ctx context.Context, cfg *config.Config, req createRequest) (*instance, error) {
	appURL, _ := url.Parse(baseURL)
	env := config.Env{NodeEnv: "test", AppBaseURL: appURL, CSRFSecret: testCSRFSecret}
	if req.Environment == "production" {
		env.NodeEnv = "production"
	}
	inst := &instance{
		clock: auth.NewManualClock(), mailer: &auth.MemoryMailer{},
		logs: &auth.MemoryLogSink{}, fixtures: map[string]map[string]string{},
	}
	var err error
	switch req.Store {
	case "", "memory":
		inst.backend = newMemoryBackend()
	case "postgres":
		if inst.backend, err = newPostgresBackend(ctx); err != nil {
			return nil, err
		}
	case "mongodb":
		if inst.backend, err = newMongoBackend(ctx); err != nil {
			return nil, err
		}
	case "sqlite", "mysql":
		if inst.backend, err = newSQLBackend(ctx, sqlstore.Kind(req.Store)); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unknown store %q", req.Store)
	}
	inst.store = inst.backend.store()
	logger := auth.NewLogger(inst.logs)
	built := false
	defer func() {
		if !built {
			inst.backend.close()
		}
	}()
	if err := inst.store.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		return nil, err
	}
	a, err := app.NewAuth(app.AuthOptions{
		Config: cfg, Env: env, Store: inst.store, Mailer: inst.mailer, Clock: inst.clock,
		RateLimitStore: inst.backend.rateLimitStore(), Logger: logger,
	})
	if err != nil {
		return nil, err
	}

	// Fixtures are written directly to storage, as a seed script would.
	hasher := auth.NewPasswordHasher(cfg.Authentication.Password.Hashing)
	for _, g := range req.Given {
		if g.Resource != nil {
			continue
		}
		now := inst.clock.Now()
		state := auth.AccountState(g.State)
		if state == "" {
			state = auth.StateActive
		}
		roles := g.Roles
		if roles == nil {
			roles = cfg.Authorization.DefaultRoles
		}
		email := g.Email
		normalized := auth.NormalizeEmail(email)
		user := auth.UserRecord{
			ID: auth.NewID(), Email: &email, EmailNormalized: &normalized, State: state,
			CreatedAt: now, UpdatedAt: now,
		}
		if state != auth.StatePending {
			user.EmailVerifiedAt = &now
		}
		if state == auth.StateDeleted {
			user.State = auth.StateActive
		}
		created, err := inst.store.CreateUser(ctx, user, s.hash(hasher, cfg.Authentication.Password.Hashing, g.Password), roles)
		if err != nil {
			return nil, err
		}
		if state == auth.StateDeleted {
			deleted := auth.StateDeleted
			if err := inst.store.UpdateUser(ctx, created.ID, auth.UserPatch{State: &deleted, DeletedAt: &now, ClearEmail: true}); err != nil {
				return nil, err
			}
			if err := inst.store.DeleteCredentials(ctx, created.ID); err != nil {
				return nil, err
			}
		}
		inst.fixtures[g.User] = map[string]string{"id": created.ID}
	}
	for _, g := range req.Given {
		if g.Resource == nil {
			continue
		}
		owner, ok := inst.fixtures[g.Resource.Owner]
		if !ok {
			return nil, fmt.Errorf("resource owner %q is not a fixture user", g.Resource.Owner)
		}
		inst.resources = append(inst.resources, resource{Type: g.Resource.Type, ID: g.Resource.ID, OwnerID: owner["id"]})
		inst.fixtures[g.Resource.ID] = map[string]string{"id": g.Resource.ID}
	}

	router, err := app.NewRouter(app.Options{
		Config: cfg, Auth: a, Logger: logger,
		Mount: func(r *gin.Engine, a *ginauth.Auth) { inst.mount(r, a, cfg) },
	})
	if err != nil {
		return nil, err
	}
	inst.handler = router
	built = true
	return inst, nil
}

// mount adds the harness routes every conformance driver provides.
func (inst *instance) mount(r *gin.Engine, a *ginauth.Auth, cfg *config.Config) {
	routes := a.ProtectedRoutes(r.Group("/__conformance"))
	ok := func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) }
	known := auth.KnownPermissions(cfg)
	names := make([]string, 0, len(known))
	for p := range known {
		names = append(names, p)
	}
	for _, permission := range names {
		routes.POST("/permission/"+permission, a.RequirePermission(permission), ok)
		routes.POST("/resource/"+permission+"/:type/:id",
			a.AuthorizeResource(permission, func(c *gin.Context) (string, string) { return c.Param("type"), c.Param("id") }), ok)
	}
	routes.POST("/unconfigured", ok) // no guard: must be denied (AUTHZ-CORE-001)
	if _, has := known["orders.view"]; has {
		routes.GET("/list/order", a.RequirePermission("orders.view"), func(c *gin.Context) {
			session := a.Context(c)
			ownerID, all, _ := auth.OwnerFilter(session.Subject, "orders.view")
			filtered := !all
			inst.mu.Lock()
			inst.listFiltered = &filtered
			ids := []string{}
			// The filter is applied by the query, not after loading everything (AUTHZ-RES-006).
			for _, res := range inst.resources {
				if res.Type == "order" && (all || res.OwnerID == ownerID) {
					ids = append(ids, res.ID)
				}
			}
			inst.mu.Unlock()
			c.JSON(http.StatusOK, gin.H{"ids": ids})
		})
	}
	a.Policies().Register("order", auth.OwnershipPolicy(func(_ context.Context, id string) (*auth.Resource, error) {
		inst.mu.Lock()
		defer inst.mu.Unlock()
		for _, res := range inst.resources {
			if res.Type == "order" && res.ID == id {
				return &auth.Resource{Type: res.Type, ID: res.ID, OwnerID: res.OwnerID}, nil
			}
		}
		return nil, nil
	}))
	r.GET("/__conformance/fault", func(c *gin.Context) {
		panic(errors.New("SELECT * FROM auth_users failed at db.go:12:3"))
	})
}
