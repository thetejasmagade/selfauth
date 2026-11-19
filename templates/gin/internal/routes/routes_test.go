package routes_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"selfauth-app/internal/app"
	"selfauth-app/internal/auth"
	"selfauth-app/internal/config"
	"selfauth-app/internal/ginauth"
	"selfauth-app/internal/routes"
	"selfauth-app/internal/store"
	"selfauth-app/internal/store/memory"
)

// The example route is guarded by authentication: anonymous requests are refused.
func TestHelloRequiresAuthentication(t *testing.T) {
	raw, err := os.ReadFile("../config/testdata/default.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Authentication.Password.Hashing = config.Hashing{MemoryKiB: 64, Iterations: 1, Parallelism: 1}
	cfg.Authentication.EmailVerification.Mode = "off"
	cfg.Authentication.Registration.SignInAfterRegistration = true
	base, _ := url.Parse("https://app.example.test")
	mem := memory.New()
	if err := mem.SyncRoles(context.Background(), auth.RoleDefinitions(cfg)); err != nil {
		t.Fatal(err)
	}
	a, err := app.NewAuth(app.AuthOptions{
		Config: cfg, Env: config.Env{NodeEnv: "test", AppBaseURL: base}, Store: mem, Mailer: &auth.MemoryMailer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	router, err := app.NewRouter(app.Options{Config: cfg, Auth: a, Mount: func(r *gin.Engine, a *ginauth.Auth) {
		routes.Register(r, a, store.DB{})
	}})
	if err != nil {
		t.Fatal(err)
	}
	serve := func(method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.RemoteAddr = "192.0.2.1:1"
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	if rec := serve("GET", "/api/hello", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", rec.Code, rec.Body)
	}
	reg := serve("POST", "/auth/register", `{"email":"a@b.co","password":"a long enough pass"}`,
		map[string]string{"Sec-Fetch-Site": "same-origin", "X-SelfAuth-CSRF": "1"})
	if reg.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", reg.Code, reg.Body)
	}
	rec := serve("GET", "/api/hello", "", map[string]string{"Cookie": reg.Result().Cookies()[0].String()})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"hello":"a@b.co"`) {
		t.Fatalf("signed in: %d %s", rec.Code, rec.Body)
	}
}
