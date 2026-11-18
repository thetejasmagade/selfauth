// Package routes is where your application's own routes live.
package routes

import (
	"example.com/app/internal/ginauth"
	"github.com/gin-gonic/gin"
)

// Register mounts application routes. Routes on a ProtectedRoutes group are
// denied unless a guard explicitly allows them (AUTHZ-CORE-001):
//
//	api := a.ProtectedRoutes(r.Group("/api"))
//	api.GET("/reports", a.RequirePermission("reports.view"), listReports)
//
// Declare the permission in selfauth.config.json first; an unknown permission
// panics when the route is defined.
func Register(r *gin.Engine, a *ginauth.Auth) {}
