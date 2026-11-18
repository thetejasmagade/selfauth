package app

import (
	"net/http"

	"selfauth-app/internal/auth"
	"selfauth-app/internal/config"
	"selfauth-app/internal/ginauth"
	"selfauth-app/internal/httpx"
	"github.com/gin-gonic/gin"
)

// Options configure the router.
type Options struct {
	Config *config.Config
	Auth   *ginauth.Auth
	Logger *auth.Logger
	// Mount registers application routes before the 404 handler.
	Mount func(r *gin.Engine, a *ginauth.Auth)
}

// NewRouter builds the Gin engine: request ID, recovery, logging, JSON body
// limit, then SelfAuth's CORS, session and CSRF middleware, then the routes.
func NewRouter(o Options) (*gin.Engine, error) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	// Route on the raw path so an encoded "/" in an ID cannot change which route matches.
	r.UseRawPath = true
	r.UnescapePathValues = true
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false
	r.HandleMethodNotAllowed = false

	// Forwarding headers are trusted only when configured (SEC-RATE-005).
	proxies, err := o.Config.TrustedProxies()
	if err != nil {
		return nil, err
	}
	if err := r.SetTrustedProxies(proxies); err != nil {
		return nil, err
	}

	r.Use(httpx.AssignRequestID(), httpx.Recovery(o.Logger))
	if o.Logger != nil {
		r.Use(httpx.RequestLog(o.Logger))
	}
	r.Use(httpx.JSONBody(o.Config.HTTP.BodyLimitBytes)) // SEC-HTTP-003
	r.Use(o.Auth.Middleware()...)

	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	o.Auth.RegisterRoutes(r.Group(o.Config.HTTP.BasePath))
	if o.Mount != nil {
		o.Mount(r, o.Auth)
	}
	r.NoRoute(func(c *gin.Context) {
		httpx.WriteError(c, http.StatusNotFound, auth.NotFound, "Not found.", nil)
	})
	return r, nil
}
