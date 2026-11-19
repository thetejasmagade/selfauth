// Command e2e is the backend for the browser end-to-end tests (apps/e2e). Test-only: it keeps email
// in memory and exposes the last message per address at /__e2e/mail so a test can follow links,
// adds a small notes module like the other reference backends, and refuses to run unless
// APP_ENV=test.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"example.com/app/internal/app"
	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/ginauth"
	"example.com/app/internal/httpx"
	"example.com/app/internal/store/memory"
	"github.com/gin-gonic/gin"
)

type note struct {
	ID      string `json:"id"`
	OwnerID string `json:"ownerId"`
	Text    string `json:"text"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	env, err := config.LoadEnv(config.OSLookup)
	if err != nil {
		return err
	}
	if env.NodeEnv != "test" {
		return fmt.Errorf("e2e runs only with APP_ENV=test")
	}
	cfg, err := config.Load("selfauth.config.json")
	if err != nil {
		return err
	}
	cfg.LocalDevelopment()
	// The example notes module the browser spec uses.
	cfg.Authorization.Permissions = append(cfg.Authorization.Permissions, "notes.create", "notes.view", "notes.view_any")
	cfg.Authorization.Roles["user"] = append(cfg.Authorization.Roles["user"], "notes.create", "notes.view")
	cfg.Authorization.Roles["support"] = []string{"notes.view_any"}
	if err := cfg.Validate(); err != nil {
		return err
	}

	ctx := context.Background()
	store := memory.New()
	if err := store.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		return err
	}
	mailer := &auth.MemoryMailer{}
	a, err := app.NewAuth(app.AuthOptions{Config: cfg, Env: env, Store: store, Mailer: mailer, Logger: auth.NewLogger(nil)})
	if err != nil {
		return err
	}
	router, err := app.NewRouter(app.Options{
		Config: cfg, Auth: a, Logger: auth.NewLogger(nil),
		Mount: func(r *gin.Engine, a *ginauth.Auth) {
			mountNotes(r, a)
			r.GET("/__e2e/mail", func(c *gin.Context) {
				if m, ok := mailer.LastTo(c.Query("to")); ok {
					link := any(nil)
					if m.Link != "" {
						link = m.Link
					}
					c.JSON(http.StatusOK, gin.H{"kind": string(m.Kind), "link": link})
					return
				}
				c.JSON(http.StatusOK, nil)
			})
			// Grants a role directly, standing in for `create-admin` in tests.
			r.POST("/__e2e/grant", func(c *gin.Context) {
				body := httpx.Body(c)
				email, _ := body["email"].(string)
				role, _ := body["role"].(string)
				user, err := store.FindUserByEmail(c.Request.Context(), auth.NormalizeEmail(email))
				if err != nil || user == nil {
					c.Status(http.StatusNotFound)
					return
				}
				if err := store.AddUserRole(c.Request.Context(), user.ID, role, nil, time.Now()); err != nil {
					c.Status(http.StatusInternalServerError)
					return
				}
				c.Status(http.StatusNoContent)
			})
		},
	})
	if err != nil {
		return err
	}
	fmt.Printf("e2e backend on :%d\n", env.Port)
	return http.ListenAndServe(fmt.Sprintf(":%d", env.Port), router)
}

func mountNotes(r *gin.Engine, a *ginauth.Auth) {
	var mu sync.Mutex
	notes := map[string]note{}
	var order []string
	a.Policies().Register("note", auth.OwnershipPolicy(func(_ context.Context, id string) (*auth.Resource, error) {
		mu.Lock()
		defer mu.Unlock()
		n, ok := notes[id]
		if !ok {
			return nil, nil
		}
		return &auth.Resource{Type: "note", ID: n.ID, OwnerID: n.OwnerID}, nil
	}))
	routes := a.ProtectedRoutes(r.Group("/api/notes"))
	routes.POST("", a.RequirePermission("notes.create"), func(c *gin.Context) {
		text, _ := httpx.Body(c)["text"].(string)
		if text == "" || len(text) > 2000 {
			httpx.WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "text is required (max 2000 characters).", nil)
			return
		}
		mu.Lock()
		id := fmt.Sprintf("note-%d", len(notes)+1)
		n := note{ID: id, OwnerID: a.Context(c).UserID, Text: text}
		notes[id] = n
		order = append(order, id)
		mu.Unlock()
		c.JSON(http.StatusCreated, gin.H{"note": n})
	})
	routes.GET("", a.RequirePermission("notes.view"), func(c *gin.Context) {
		owner, all, _ := auth.OwnerFilter(a.Context(c).Subject, "notes.view")
		mu.Lock()
		defer mu.Unlock()
		visible := []note{}
		for _, id := range order {
			if all || notes[id].OwnerID == owner {
				visible = append(visible, notes[id])
			}
		}
		c.JSON(http.StatusOK, gin.H{"notes": visible})
	})
	routes.GET("/:id",
		a.AuthorizeResource("notes.view", func(c *gin.Context) (string, string) { return "note", c.Param("id") }),
		func(c *gin.Context) {
			mu.Lock()
			defer mu.Unlock()
			c.JSON(http.StatusOK, gin.H{"note": notes[c.Param("id")]})
		})
}
