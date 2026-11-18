// Package ginauth is the Gin binding of the SelfAuth core: cookies, CORS, the
// session lookup, CSRF protection, the /auth routes (AUTHENTICATION_SPEC §11),
// route guards and deny-by-default protected routes.
package ginauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/httpx"
	"github.com/gin-gonic/gin"
)

const (
	authKey       = "selfauth.context"
	authorizedKey = "selfauth.authorized"
	presentedKey  = "selfauth.presentedToken"
)

// Options configure the adapter.
type Options struct {
	Config     *config.Config
	Service    *auth.Service
	Policies   *auth.PolicyRegistry
	AppBaseURL *url.URL
	Clock      auth.Clock
	Logger     *auth.Logger
	// CSRFSecret is required when http.csrf.mode is "token" (SEC-CSRF-004); at least 32 bytes.
	CSRFSecret []byte
	// CSRFSecretPrevious is accepted during rotation (SEC-SECRET-004).
	CSRFSecretPrevious []byte
}

// Auth is the adapter.
type Auth struct {
	cfg        *config.Config
	service    *auth.Service
	policies   *auth.PolicyRegistry
	clock      auth.Clock
	logger     *auth.Logger
	csrfSecret []byte
	csrfPrev   []byte
	trusted    map[string]struct{}
	known      map[string]struct{}
}

// New validates the options and builds the adapter.
func New(o Options) (*Auth, error) {
	if o.Config.HTTP.CSRF.Mode == "token" && len(o.CSRFSecret) < 32 {
		return nil, errors.New("http.csrf.mode 'token' requires a CSRF secret of at least 32 bytes (SEC-SECRET-003)")
	}
	trusted := map[string]struct{}{}
	for _, origin := range o.Config.HTTP.TrustedOrigins {
		trusted[origin] = struct{}{}
	}
	trusted[origin(o.AppBaseURL)] = struct{}{}
	return &Auth{
		cfg: o.Config, service: o.Service, policies: o.Policies, clock: o.Clock, logger: o.Logger,
		csrfSecret: o.CSRFSecret, csrfPrev: o.CSRFSecretPrevious,
		trusted: trusted, known: auth.KnownPermissions(o.Config),
	}, nil
}

// origin is scheme://host[:port] with the default port removed, like URL#origin.
func origin(u *url.URL) string {
	host := u.Hostname()
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host
}

// Service exposes the core for application code (for example a seed script).
func (a *Auth) Service() *auth.Service { return a.service }

// Policies is the resource policy registry (AUTHZ-RES-001).
func (a *Auth) Policies() *auth.PolicyRegistry { return a.policies }

// Context returns the validated session context, or nil.
func (a *Auth) Context(c *gin.Context) *auth.Context {
	if v, ok := c.Get(authKey); ok {
		if ctx, ok := v.(*auth.Context); ok {
			return ctx
		}
	}
	return nil
}

// detached keeps request values but not cancellation: once a state-changing
// operation has started it runs to completion even if the client disconnects, so
// a token is never consumed without its effect being applied.
func detached(c *gin.Context) context.Context { return context.WithoutCancel(c.Request.Context()) }

func (a *Auth) rc(c *gin.Context) auth.RequestContext {
	return auth.RequestContext{IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: httpx.RequestID(c)}
}

func header(c *gin.Context, name string) (string, bool) {
	v := c.Request.Header.Values(name)
	if len(v) == 0 {
		return "", false
	}
	return v[0], true
}

// ── errors ──

// Abort renders err as the spec error envelope. Anything that is not an
// auth.Error is a 500 whose cause is logged, redacted, and never returned.
func (a *Auth) Abort(c *gin.Context, err error) {
	var ae *auth.Error
	if !errors.As(err, &ae) {
		httpx.Internal(c, a.logger, err)
		return
	}
	if ae.RetryAfterSeconds > 0 {
		c.Header("Retry-After", fmt.Sprint(ae.RetryAfterSeconds))
	}
	c.Header("Cache-Control", "no-store")
	httpx.WriteError(c, auth.HTTPStatus[ae.Code], ae.Code, ae.Message, ae.Details)
}

// ── cookies ──

func sameSite(v string) http.SameSite {
	switch v {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	}
	return http.SameSiteLaxMode
}

func (a *Auth) setSessionCookie(c *gin.Context, issued auth.IssuedSession) {
	cookie := a.cfg.Authentication.Sessions.Cookie
	maxAge := int(issued.Session.AbsoluteExpiresAt.Sub(a.clock.Now()).Seconds())
	// Never longer than the absolute session lifetime (SEC-COOKIE-004).
	maxAge = min(max(maxAge, 0), a.cfg.Authentication.Sessions.AbsoluteTimeoutMinutes*60)
	if maxAge == 0 {
		maxAge = -1
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cookie.Name, Value: issued.Token, Path: "/", MaxAge: maxAge,
		HttpOnly: true, Secure: cookie.Secure, SameSite: sameSite(cookie.SameSite),
	})
}

func (a *Auth) clearSessionCookie(c *gin.Context) {
	cookie := a.cfg.Authentication.Sessions.Cookie
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cookie.Name, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: cookie.Secure, SameSite: sameSite(cookie.SameSite),
	})
}

// ── CSRF tokens bound to the session (token mode) ──

func (a *Auth) csrfTokenFor(sessionID string, key []byte) string {
	if len(key) == 0 {
		return ""
	}
	return auth.HMACSHA256(key, "csrf:"+sessionID)
}

// csrfField is merged into responses that start or describe a session.
func (a *Auth) csrfField(body gin.H, sessionID string) gin.H {
	if a.cfg.HTTP.CSRF.Mode == "token" {
		body["csrfToken"] = a.csrfTokenFor(sessionID, a.csrfSecret)
	}
	return body
}

func (a *Auth) validCSRFToken(sessionID, presented string) bool {
	if presented == "" {
		return false
	}
	for _, key := range [][]byte{a.csrfSecret, a.csrfPrev} {
		if expected := a.csrfTokenFor(sessionID, key); expected != "" && auth.SafeEqual(expected, presented) {
			return true
		}
	}
	return false
}

// ── middleware ──

// Middleware returns CORS, session lookup and CSRF protection, in that order.
// Mount it before your routes.
func (a *Auth) Middleware() []gin.HandlerFunc {
	return []gin.HandlerFunc{a.cors, a.session, a.csrf}
}

func (a *Auth) cors(c *gin.Context) {
	o, hasOrigin := header(c, "Origin")
	trusted := false
	if hasOrigin {
		_, trusted = a.trusted[o]
	}
	if trusted {
		// Explicit allow-list only, never reflection (SEC-CORS-001).
		c.Header("Access-Control-Allow-Origin", o)
		c.Header("Access-Control-Allow-Credentials", "true")
	}
	c.Writer.Header().Add("Vary", "Origin")
	if _, preflight := header(c, "Access-Control-Request-Method"); c.Request.Method == http.MethodOptions && preflight {
		if trusted {
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE")
			c.Header("Access-Control-Allow-Headers", "Content-Type, "+a.cfg.HTTP.CSRF.HeaderName)
			c.Header("Access-Control-Max-Age", "600")
		}
		c.AbortWithStatus(http.StatusNoContent)
		return
	}
	c.Next()
}

func (a *Auth) session(c *gin.Context) {
	token := ""
	if cookie, err := c.Request.Cookie(a.cfg.Authentication.Sessions.Cookie.Name); err == nil {
		token = cookie.Value
		if decoded, err := url.PathUnescape(token); err == nil {
			token = decoded
		}
	}
	c.Set(presentedKey, token)
	ctx, err := a.service.Authenticate(detached(c), token)
	if err != nil {
		a.Abort(c, err)
		return
	}
	if ctx != nil {
		c.Set(authKey, ctx)
	}
	c.Next()
}

func (a *Auth) csrf(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		c.Next() // SEC-CSRF-002: safe methods never change state
		return
	}
	csrf := a.cfg.HTTP.CSRF
	fetchSite, _ := header(c, "Sec-Fetch-Site")
	o, hasOrigin := header(c, "Origin")
	presented, _ := header(c, csrf.HeaderName)
	session := a.Context(c)
	_, originTrusted := a.trusted[o]

	ok := fetchSite != "cross-site" && (!hasOrigin || originTrusted)
	switch {
	case ok && csrf.Mode == "header":
		ok = presented != ""
	case ok && session != nil:
		ok = a.validCSRFToken(session.Session.ID, presented)
	case ok:
		// Token mode without a session (login, registration): require browser origin proof.
		ok = (hasOrigin && originTrusted) || fetchSite == "same-origin"
	}
	if ok {
		c.Next()
		return
	}
	if err := a.service.CSRFRejected(detached(c), a.rc(c)); err != nil {
		a.Abort(c, err)
		return
	}
	a.Abort(c, &auth.Error{Code: auth.CSRFFailed, Message: "Request origin could not be verified."})
}

// ── guards ──

func (a *Auth) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if a.Context(c) == nil {
			a.Abort(c, auth.Fail(auth.Unauthenticated))
			return
		}
		c.Next()
	}
}

func (a *Auth) assertKnown(permission string) {
	if _, ok := a.known[permission]; !ok {
		panic(fmt.Sprintf("unknown permission %q (AUTHZ-PERM-004)", permission))
	}
}

// RequirePermission allows subjects that hold permission. It panics at
// definition time for an undefined permission (AUTHZ-PERM-004).
func (a *Auth) RequirePermission(permission string) gin.HandlerFunc {
	a.assertKnown(permission)
	return func(c *gin.Context) {
		session := a.Context(c)
		if session == nil {
			a.Abort(c, auth.Fail(auth.Unauthenticated))
			return
		}
		if !session.Has(permission) {
			a.Abort(c, auth.Fail(auth.Forbidden))
			return
		}
		c.Set(authorizedKey, true)
		c.Next()
	}
}

// AuthorizeResource decides on a resource loaded from storage by its registered
// policy; the resource's type and ID come from the route.
func (a *Auth) AuthorizeResource(permission string, resource func(c *gin.Context) (resourceType, id string)) gin.HandlerFunc {
	a.assertKnown(permission)
	return func(c *gin.Context) {
		session := a.Context(c)
		if session == nil {
			a.Abort(c, auth.Fail(auth.Unauthenticated))
			return
		}
		resourceType, id := resource(c)
		decision, err := a.policies.Decide(detached(c), session.Subject, permission, resourceType, id)
		switch {
		case err != nil:
			a.Abort(c, err)
		case decision == auth.Allow:
			c.Set(authorizedKey, true)
			c.Next()
		case decision == auth.DecideNotFound:
			a.Abort(c, auth.Fail(auth.NotFound))
		default:
			a.Abort(c, auth.Fail(auth.Forbidden))
		}
	}
}

func (a *Auth) denyUnlessAuthorized(c *gin.Context) {
	if v, _ := c.Get(authorizedKey); v != true {
		a.Abort(c, auth.Fail(auth.Forbidden))
		return
	}
	c.Next()
}

// Protected registers routes that are denied unless a guard explicitly allows
// them (AUTHZ-CORE-001): authentication first, then your guards, then the
// deny-unless-authorized check, then the handler.
type Protected struct {
	a     *Auth
	group gin.IRoutes
}

// ProtectedRoutes wraps a router group.
func (a *Auth) ProtectedRoutes(group gin.IRoutes) *Protected { return &Protected{a: a, group: group} }

func (p *Protected) handle(method, path string, handlers []gin.HandlerFunc) *Protected {
	if len(handlers) == 0 {
		panic("route needs a handler")
	}
	chain := []gin.HandlerFunc{p.a.RequireAuth()}
	chain = append(chain, handlers[:len(handlers)-1]...)
	chain = append(chain, p.a.denyUnlessAuthorized, handlers[len(handlers)-1])
	p.group.Handle(method, path, chain...)
	return p
}

func (p *Protected) GET(path string, h ...gin.HandlerFunc) *Protected {
	return p.handle(http.MethodGet, path, h)
}
func (p *Protected) POST(path string, h ...gin.HandlerFunc) *Protected {
	return p.handle(http.MethodPost, path, h)
}
func (p *Protected) PUT(path string, h ...gin.HandlerFunc) *Protected {
	return p.handle(http.MethodPut, path, h)
}
func (p *Protected) PATCH(path string, h ...gin.HandlerFunc) *Protected {
	return p.handle(http.MethodPatch, path, h)
}
func (p *Protected) DELETE(path string, h ...gin.HandlerFunc) *Protected {
	return p.handle(http.MethodDelete, path, h)
}
