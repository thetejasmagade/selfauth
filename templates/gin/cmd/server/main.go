// Command server runs the application.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"selfauth-app/internal/app"
	"selfauth-app/internal/auth"
	"selfauth-app/internal/config"
	"selfauth-app/internal/email"
	"selfauth-app/internal/ginauth"
	"selfauth-app/internal/routes"
	"selfauth-app/internal/store"
)

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
	cfg, err := config.Load(configPath())
	if err != nil {
		return err
	}
	// Plain-http local development cannot use Secure or __Host- cookies.
	if !env.Production() {
		cfg.LocalDevelopment()
	}
	mailer, err := email.NewMailer(env)
	if err != nil {
		return err
	}
	stores, err := store.New(context.Background(), cfg, env)
	if err != nil {
		return err
	}
	defer stores.Close()

	logger := auth.NewLogger(nil)
	a, err := app.NewAuth(app.AuthOptions{
		Config: cfg, Env: env, Store: stores.Store, Mailer: mailer, RateLimitStore: stores.RateLimitStore, Logger: logger,
	})
	if err != nil {
		return err
	}
	router, err := app.NewRouter(app.Options{Config: cfg, Auth: a, Logger: logger, Mount: func(r *gin.Engine, a *ginauth.Auth) {
		routes.Register(r, a, stores.DB)
	}})
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", env.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// Bind first, so "Listening" is only printed once the port is really ours.
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("could not start on port %d: %w", env.Port, err)
	}
	log.Printf("Listening on http://localhost:%d", env.Port)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// configPath is the resolved SelfAuth configuration file; behavior only, never secrets.
func configPath() string {
	if p := os.Getenv("SELFAUTH_CONFIG"); p != "" {
		return p
	}
	return "selfauth.config.json"
}
