package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"selfauth-app/internal/auth"
	"selfauth-app/internal/config"
	"selfauth-app/internal/ginauth"
	"selfauth-app/internal/store/memory"
	"github.com/gin-gonic/gin"
)

type harness struct {
	t      *testing.T
	router *gin.Engine
	mailer *auth.MemoryMailer
	auth   *ginauth.Auth
}

func testConfig(t *testing.T, edit func(*config.Config)) *config.Config {
	t.Helper()
	raw, err := os.ReadFile("../config/testdata/default.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Authentication.Password.Hashing = config.Hashing{MemoryKiB: 64, Iterations: 1, Parallelism: 1}
	cfg.Authentication.EmailVerification.Mode = "off" // accounts are usable right after registration
	cfg.Authentication.Registration.SignInAfterRegistration = true
	if edit != nil {
		edit(cfg)
	}
	return cfg
}

func newHarness(t *testing.T, cfg *config.Config, appEnv string) *harness {
	t.Helper()
	base, _ := url.Parse("https://app.example.test")
	env := config.Env{NodeEnv: appEnv, AppBaseURL: base, CSRFSecret: []byte(strings.Repeat("s", 32))}
	store := memory.New()
	if err := store.SyncRoles(context.Background(), auth.RoleDefinitions(cfg)); err != nil {
		t.Fatal(err)
	}
	mailer := &auth.MemoryMailer{}
	a, err := NewAuth(AuthOptions{Config: cfg, Env: env, Store: store, Mailer: mailer})
	if err != nil {
		t.Fatal(err)
	}
	router, err := NewRouter(Options{Config: cfg, Auth: a})
	if err != nil {
		t.Fatal(err)
	}
	return &harness{t: t, router: router, mailer: mailer, auth: a}
}

func (h *harness) do(method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.10:1234"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

var browser = map[string]string{"Sec-Fetch-Site": "same-origin", "X-SelfAuth-CSRF": "1"}

func with(extra map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range browser {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct{ Error struct{ Code string } }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("not an error envelope: %s", rec.Body.String())
	}
	return body.Error.Code
}

const credentials = `{"email":"a@b.co","password":"a long enough pass"}`

func TestRegisterLoginMeLogout(t *testing.T) {
	h := newHarness(t, testConfig(t, nil), "test")
	rec := h.do("POST", "/auth/register", credentials, browser)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	cookie := rec.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.Name != "__Host-session" || cookie.Path != "/" || cookie.Domain != "" {
		t.Fatalf("session cookie must be HttpOnly, Secure, host-only: %+v", cookie)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if strings.Contains(rec.Body.String(), cookie.Value) {
		t.Error("the session token must never appear in a response body")
	}

	me := h.do("GET", "/auth/me", "", map[string]string{"Cookie": cookie.String()})
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"email":"a@b.co"`) {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}
	if h.do("POST", "/auth/logout", "", with(map[string]string{"Cookie": cookie.String()})).Code != http.StatusNoContent {
		t.Fatal("logout failed")
	}
	if h.do("GET", "/auth/me", "", map[string]string{"Cookie": cookie.String()}).Code != http.StatusUnauthorized {
		t.Fatal("a revoked session must not authenticate")
	}
}

func TestCSRFHeaderMode(t *testing.T) {
	h := newHarness(t, testConfig(t, nil), "test")
	for name, headers := range map[string]map[string]string{
		"no header":        {"Sec-Fetch-Site": "same-origin"},
		"cross-site":       with(map[string]string{"Sec-Fetch-Site": "cross-site"}),
		"untrusted origin": with(map[string]string{"Origin": "https://evil.example"}),
	} {
		rec := h.do("POST", "/auth/register", credentials, headers)
		if rec.Code != http.StatusForbidden || errorCode(t, rec) != "CSRF_FAILED" {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if rec := h.do("POST", "/auth/register", credentials, with(map[string]string{"Origin": "https://app.example.test"})); rec.Code != http.StatusCreated {
		t.Errorf("the application's own origin must be trusted: %d %s", rec.Code, rec.Body)
	}
}

func TestCSRFTokenModeBindsTokenToSession(t *testing.T) {
	h := newHarness(t, testConfig(t, func(c *config.Config) { c.HTTP.CSRF.Mode = "token" }), "test")
	rec := h.do("POST", "/auth/register", credentials, browser)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	var body struct {
		CSRFToken string `json:"csrfToken"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	cookie := rec.Result().Cookies()[0].String()
	if body.CSRFToken == "" {
		t.Fatal("token mode must return a CSRF token")
	}
	if got := h.do("POST", "/auth/logout-all", "", with(map[string]string{"Cookie": cookie})); got.Code != http.StatusForbidden {
		t.Errorf("the constant header must not satisfy token mode: %d", got.Code)
	}
	if got := h.do("POST", "/auth/logout-all", "", with(map[string]string{"Cookie": cookie, "X-SelfAuth-CSRF": body.CSRFToken})); got.Code != http.StatusNoContent {
		t.Errorf("the session's token must be accepted: %d %s", got.Code, got.Body)
	}
}

func TestBodyLimitAndMalformedJSON(t *testing.T) {
	h := newHarness(t, testConfig(t, nil), "test")
	big := `{"padding":"` + strings.Repeat("x", 17000) + `"}`
	if rec := h.do("POST", "/auth/login", big, browser); rec.Code != http.StatusRequestEntityTooLarge || errorCode(t, rec) != "PAYLOAD_TOO_LARGE" {
		t.Errorf("oversized body: %d %s", rec.Code, rec.Body)
	}
	if rec := h.do("POST", "/auth/login", `{"email":`, browser); rec.Code != http.StatusBadRequest || errorCode(t, rec) != "VALIDATION_FAILED" {
		t.Errorf("malformed body: %d %s", rec.Code, rec.Body)
	}
}

// Forwarding headers must not let a client choose its own rate-limit identity (SEC-RATE-005).
func TestForwardedForIsIgnoredUnlessConfigured(t *testing.T) {
	cfg := testConfig(t, func(c *config.Config) {
		c.Authentication.RateLimit.Login.PerAddress = config.RateLimitRule{Limit: 2, WindowSeconds: 900}
	})
	h := newHarness(t, cfg, "test")
	var last *httptest.ResponseRecorder
	for i := 0; i < 3; i++ {
		last = h.do("POST", "/auth/login", `{"email":"x@y.co","password":"whatever"}`, with(map[string]string{"X-Forwarded-For": "203.0.113." + string(rune('1'+i))}))
	}
	if last.Code != http.StatusTooManyRequests || last.Header().Get("Retry-After") == "" {
		t.Fatalf("spoofed X-Forwarded-For escaped the per-address limit: %d %s", last.Code, last.Body)
	}
}

func TestUnknownRoutesAndInternalErrorsUseTheEnvelope(t *testing.T) {
	h := newHarness(t, testConfig(t, nil), "test")
	if rec := h.do("GET", "/nope", "", nil); rec.Code != http.StatusNotFound || errorCode(t, rec) != "NOT_FOUND" {
		t.Errorf("404: %d %s", rec.Code, rec.Body)
	}
	if rec := h.do("GET", "/auth/sessions/a%2Fb", "", nil); rec.Code == http.StatusInternalServerError {
		t.Errorf("an encoded slash in an id must not break routing: %d", rec.Code)
	}
}

func TestProtectedRoutesDenyByDefault(t *testing.T) {
	cfg := testConfig(t, func(c *config.Config) { c.Authorization.Permissions = []string{"reports.view"} })
	base, _ := url.Parse("https://app.example.test")
	store := memory.New()
	_ = store.SyncRoles(context.Background(), auth.RoleDefinitions(cfg))
	a, err := NewAuth(AuthOptions{Config: cfg, Env: config.Env{NodeEnv: "test", AppBaseURL: base, CSRFSecret: []byte(strings.Repeat("s", 32))}, Store: store, Mailer: &auth.MemoryMailer{}})
	if err != nil {
		t.Fatal(err)
	}
	router, _ := NewRouter(Options{Config: cfg, Auth: a, Mount: func(r *gin.Engine, a *ginauth.Auth) {
		api := a.ProtectedRoutes(r.Group("/api"))
		api.GET("/open", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) }) // no guard
		api.GET("/reports", a.RequirePermission("reports.view"), func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	}})
	h := &harness{t: t, router: router}
	h.mailer = &auth.MemoryMailer{}
	rec := h.do("POST", "/auth/register", credentials, browser)
	cookie := rec.Result().Cookies()[0].String()
	if got := h.do("GET", "/api/open", "", nil); got.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", got.Code)
	}
	if got := h.do("GET", "/api/open", "", map[string]string{"Cookie": cookie}); got.Code != http.StatusForbidden {
		t.Errorf("an unguarded protected route must be denied: %d", got.Code)
	}
	if got := h.do("GET", "/api/reports", "", map[string]string{"Cookie": cookie}); got.Code != http.StatusForbidden {
		t.Errorf("a user without the permission must be denied: %d", got.Code)
	}
	defer func() {
		if recover() == nil {
			t.Error("requiring an undefined permission must fail at definition time (AUTHZ-PERM-004)")
		}
	}()
	a.RequirePermission("typo.permission")
}

func TestProductionRefusesUnsafeSettings(t *testing.T) {
	base, _ := url.Parse("https://app.example.test")
	httpBase, _ := url.Parse("http://app.example.test")
	cfg := testConfig(t, nil)
	insecure := testConfig(t, func(c *config.Config) { c.Authentication.Sessions.Cookie.Secure = false })
	for name, o := range map[string]AuthOptions{
		"insecure cookie": {Config: insecure, Env: config.Env{NodeEnv: "production", AppBaseURL: base}},
		"http base url":   {Config: cfg, Env: config.Env{NodeEnv: "production", AppBaseURL: httpBase}},
	} {
		o.Store, o.Mailer = memory.New(), &auth.MemoryMailer{}
		if _, err := NewAuth(o); err == nil {
			t.Errorf("%s: accepted in production", name)
		}
	}
}

// SEC-HASH-006: hashing must not stall other requests. Many password hashes run at once while a
// request that needs none is answered straight away.
func TestHashingDoesNotBlockOtherRequests(t *testing.T) {
	cfg := testConfig(t, func(c *config.Config) {
		// Real parameters, so each hash takes measurable time.
		c.Authentication.Password.Hashing = config.Hashing{MemoryKiB: 19_456, Iterations: 2, Parallelism: 1}
		big := config.RateLimitRule{Limit: 100_000, WindowSeconds: 900}
		c.Authentication.RateLimit.Register = config.RateLimitOperation{PerAccount: big, PerAddress: big}
	})
	h := newHarness(t, cfg, "test")
	const hashes = 24
	done := make(chan struct{}, hashes)
	for i := 0; i < hashes; i++ {
		go func(i int) {
			body := fmt.Sprintf(`{"email":"u%d@b.co","password":"a long enough pass"}`, i)
			h.do("POST", "/auth/register", body, browser)
			done <- struct{}{}
		}(i)
	}
	if rec := h.do("GET", "/health", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("health: %d", rec.Code)
	}
	if len(done) == hashes {
		t.Fatal("every hash finished before a request that needs none was answered: hashing is blocking other requests")
	}
	for i := 0; i < hashes; i++ {
		<-done
	}
}

// SEC-TOKEN-005 and SEC-REDIRECT-001: responses carry a no-referrer policy, and the backend never
// redirects, so no request parameter can steer a browser anywhere.
func TestResponsesNeverRedirectAndSendNoReferrer(t *testing.T) {
	h := newHarness(t, testConfig(t, nil), "test")
	if rec := h.do("POST", "/auth/register", credentials, browser); rec.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Errorf("Referrer-Policy = %q", rec.Header().Get("Referrer-Policy"))
	}
	for _, path := range []string{
		"/auth/login?redirect=https://evil.example", "/auth/login/", "/auth//login", "/AUTH/login",
		"/auth/me?next=//evil.example", "/health/", "/nope?redirect=/x",
	} {
		for _, method := range []string{"GET", "POST"} {
			rec := h.do(method, path, "", browser)
			if rec.Code >= 300 && rec.Code < 400 || rec.Header().Get("Location") != "" {
				t.Errorf("%s %s redirected: %d %q", method, path, rec.Code, rec.Header().Get("Location"))
			}
		}
	}
}

// SEC-SECRET-003: token-mode CSRF cannot start without a secret.
func TestTokenModeNeedsASecret(t *testing.T) {
	cfg := testConfig(t, func(c *config.Config) { c.HTTP.CSRF.Mode = "token" })
	base, _ := url.Parse("https://app.example.test")
	for name, secret := range map[string][]byte{"none": nil, "too short": []byte("short")} {
		_, err := NewAuth(AuthOptions{
			Config: cfg, Env: config.Env{NodeEnv: "test", AppBaseURL: base, CSRFSecret: secret},
			Store: memory.New(), Mailer: &auth.MemoryMailer{},
		})
		if err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// SEC-SECRET-004: a rotated-out secret still verifies, but only the current one signs.
func TestCSRFSecretRotation(t *testing.T) {
	cfg := testConfig(t, func(c *config.Config) { c.HTTP.CSRF.Mode = "token" })
	base, _ := url.Parse("https://app.example.test")
	oldSecret, newSecret := []byte(strings.Repeat("o", 32)), []byte(strings.Repeat("n", 32))
	store := memory.New()
	_ = store.SyncRoles(context.Background(), auth.RoleDefinitions(cfg))
	build := func(secret, previous []byte) *harness {
		a, err := NewAuth(AuthOptions{
			Config: cfg, Env: config.Env{NodeEnv: "test", AppBaseURL: base, CSRFSecret: secret, CSRFSecretPrevious: previous},
			Store: store, Mailer: &auth.MemoryMailer{},
		})
		if err != nil {
			t.Fatal(err)
		}
		router, _ := NewRouter(Options{Config: cfg, Auth: a})
		return &harness{t: t, router: router}
	}
	before := build(oldSecret, nil)
	rec := before.do("POST", "/auth/register", credentials, browser)
	var body struct {
		CSRFToken string `json:"csrfToken"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	cookie := rec.Result().Cookies()[0].String()
	call := func(h *harness, token string) int {
		return h.do("POST", "/auth/logout-all", "", with(map[string]string{"Cookie": cookie, "X-SelfAuth-CSRF": token})).Code
	}
	after := build(newSecret, oldSecret) // rotated: the old secret is "previous"
	if got := call(after, body.CSRFToken); got != http.StatusNoContent {
		t.Fatalf("a token signed with the previous secret must still be accepted: %d", got)
	}
	// Once the previous secret is dropped, tokens signed with it stop working.
	rec = before.do("POST", "/auth/login", credentials, browser)
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	cookie = rec.Result().Cookies()[0].String()
	dropped := build(newSecret, nil)
	if got := call(dropped, body.CSRFToken); got != http.StatusForbidden {
		t.Fatalf("a token signed with a dropped secret must be refused: %d", got)
	}
}
