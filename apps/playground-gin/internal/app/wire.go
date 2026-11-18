// Package app wires the configuration, the SelfAuth core and the Gin router.
package app

import (
	"errors"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/ginauth"
)

// AuthOptions are the inputs of NewAuth.
type AuthOptions struct {
	Config         *config.Config
	Env            config.Env
	Store          auth.Store
	Mailer         auth.Mailer
	Clock          auth.Clock
	RateLimitStore auth.RateLimitStore
	Logger         *auth.Logger
}

// NewAuth builds the authentication service and its Gin adapter, refusing unsafe
// production settings.
func NewAuth(o AuthOptions) (*ginauth.Auth, error) {
	cfg := o.Config
	// SEC-COOKIE-003: insecure cookies only outside production.
	if o.Env.Production() && !cfg.Authentication.Sessions.Cookie.Secure {
		return nil, errors.New("authentication.sessions.cookie.secure must be true in production")
	}
	if o.Env.Production() && o.Env.AppBaseURL.Scheme != "https" {
		return nil, errors.New("the application base URL must use https in production (SEC-HTTP-002)")
	}
	clock := o.Clock
	if clock == nil {
		clock = auth.SystemClock
	}
	rateStore := o.RateLimitStore
	if rateStore == nil {
		rateStore = auth.NewMemoryRateLimitStore()
	}
	service := auth.NewService(auth.Deps{
		Config: cfg, Store: o.Store, Mailer: o.Mailer, Clock: clock,
		Hasher:     auth.NewPasswordHasher(cfg.Authentication.Password.Hashing),
		Limiter:    auth.NewRateLimiter(rateStore, clock),
		AppBaseURL: o.Env.AppBaseURL,
	})
	return ginauth.New(ginauth.Options{
		Config: cfg, Service: service, Policies: auth.NewPolicyRegistry(), AppBaseURL: o.Env.AppBaseURL,
		Clock: clock, Logger: o.Logger, CSRFSecret: o.Env.CSRFSecret, CSRFSecretPrevious: o.Env.CSRFSecretPrevious,
	})
}
