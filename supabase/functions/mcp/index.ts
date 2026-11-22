// Supabase Edge Function: mcp
//
// The Cafelytic MCP server: lets a user connect an AI app (Claude, ChatGPT, any
// MCP client) to their own Cafelytic account. Streamable HTTP, stateless: a
// fresh McpServer is built for every request.
//
// Sign-in is OAuth 2.1 against this project's Supabase Auth (Authentication >
// OAuth Server in the dashboard; the consent page is oauth/consent.html). The
// token the AI app ends up with is the user's own Supabase JWT, so:
//   - withOAuthProtectedResource() answers the discovery request and adds the
//     WWW-Authenticate pointer to every 401, which is how a client finds the
//     sign-in.
//   - withSupabase({ auth: "user" }) verifies the JWT against the project's
//     signing keys and hands the tools a client scoped to that user. Row-level
//     security applies to everything the tools do. No tool uses the service
//     role.
//
// config.toml sets verify_jwt = false for this function: the gateway must let
// the unauthenticated discovery request through, and the check above replaces
// it. What an AI-app login may do at the database is limited separately, in
// supabase/migrations/20261122200921_restrict_oauth_client_access.sql.
//
// Deploy (user-run, like every function here): supabase functions deploy mcp

import { createMcpHandler } from "@modelcontextprotocol/server";
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { buildServer } from "./tools.ts";

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
    (req, { supabase, userClaims }) => {
      // withSupabase has already rejected a request with no valid user JWT;
      // this is a guard against a token that verifies but names no user.
      if (!userClaims?.id) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }));
      }
      const userId = userClaims.id;
      const handler = createMcpHandler(() => buildServer(supabase, userId), {
        onerror: (error) => console.error("MCP request failed", error),
      });
      return handler.fetch(req);
    },
  ),
);
