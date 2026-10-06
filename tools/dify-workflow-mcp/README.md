# Dify Workflow MCP

Local stdio MCP server for Dify Cloud. It exposes draft read/preview/update, DSL create, Chatflow replacement, and published workflow run tools. Management requests are restricted to `cloud.dify.ai`; writes require the exact current draft hash and app ID confirmation, and never publish.

## Setup

```sh
cd tools/dify-workflow-mcp
npm install
cp .env.example .env
```

Fill in `.env` locally. Do not paste credentials into chat or commit `.env`:

```dotenv
DIFY_CONSOLE_TOKEN=your_short_lived_console_access_token
DIFY_CSRF_TOKEN=your_csrf_cookie_value
DIFY_CSRF_COOKIE_NAME=csrf_token
DIFY_REFRESH_TOKEN=your_refresh_cookie_value
DIFY_REFRESH_COOKIE_NAME=refresh_token
DIFY_ACCESS_COOKIE_NAME=access_token
DIFY_PROXY_URL=http://127.0.0.1:7897
DIFY_WORKFLOW_API_KEYS={"bf81cd44-a49f-4048-901f-e95e941dc429":"app-...","dddd27b9-e7c5-4936-90da-8640d7ac8991":"app-..."}
DIFY_ALLOWED_APP_IDS=bf81cd44-a49f-4048-901f-e95e941dc429,dddd27b9-e7c5-4936-90da-8640d7ac8991
```

`DIFY_CONSOLE_TOKEN` is a Dify Cloud console login access token for an account with edit permission on these apps. It is not an app API key. App API keys are only used by `run_workflow`. Keep this local file private and refresh the console token when Dify expires it.

For write requests, Dify Cloud also requires its CSRF cookie and matching `X-CSRF-Token` header. Copy the CSRF cookie's value into `DIFY_CSRF_TOKEN`, and set `DIFY_CSRF_COOKIE_NAME` to the exact cookie name shown in the browser (often `csrf_token` or `__Host-csrf_token`). Keep both tokens private and refresh them together when the console session expires.

To avoid manually copying short-lived console tokens repeatedly, also configure the current `refresh_token` cookie in `DIFY_REFRESH_TOKEN`. Set `DIFY_REFRESH_COOKIE_NAME` to its exact browser cookie name; `DIFY_ACCESS_COOKIE_NAME` should match the access token cookie name. On an expired access token the MCP calls Dify's `/console/api/refresh-token`, retries the request, and writes the rotated access, CSRF, and refresh token values back to this ignored `.env` file with mode `600`.

`DIFY_PROXY_URL` defaults to the local macOS proxy at `http://127.0.0.1:7897`, because Node's `fetch` does not automatically use the system proxy. Change it to match the active local proxy, or set it to an empty value to connect directly.

Register the stdio server with Codex:

```sh
codex mcp add smartCabinDify -- node "$PWD/src/index.mjs"
codex mcp list
```

Restart Codex to discover the tools. Run these commands from this directory so the executable path resolves correctly. If `codex mcp add` is unavailable in the desktop install, add the equivalent stdio server entry to `~/.codex/config.toml`.

## Updating an existing workflow

1. Call `get_workflow` to capture the current draft hash.
2. Call `preview_workflow_update` with the target app ID and DSL text; inspect node counts and graph summary.
3. Call `update_workflow` with the same DSL, that hash as `expected_hash`, and the exact target app ID as `confirmation_app_id`.
4. Call `get_workflow` again and compare the saved graph. Publish separately in Dify only after reviewing and testing the draft.

The default allowlist contains the two app IDs supplied for the smart-cabin v2 workflows. Set `DIFY_ALLOWED_APP_IDS` to a comma-separated allowlist if it changes. Newly created IDs are allowed for the current MCP process only; add them to the environment allowlist before a later restart.

## Replacing an existing Chatflow

1. Build `tmp/dify-import/realtime-host-director-chatflow-v3.yml` with `node tools/dify-workflow-mcp/scripts/build-host-chatflow.mjs` from the project root.
2. Call `preview_chatflow_replace` with the existing app ID and the DSL. Confirm the target app ID and inspect the proposed graph and memory setting.
3. Call `replace_chatflow` with the exact current hash and the same app ID in `confirmation_app_id`. This updates the existing draft graph, features and conversation variables directly; it does not import a new app or publish.
4. Read the app draft again, test in Dify, then publish manually.

The Chatflow API runtime uses `DIFY_CHATFLOW_API_KEY` (or `DIFY_API_KEY`) in the Demo server environment. `DIFY_WORKFLOW_API_KEYS` is also accepted as a JSON map keyed by app ID.

The current Chatflow app ID is `74bef8bd-22bd-4e19-91da-5e8d645dd8ed`; include it in `DIFY_ALLOWED_APP_IDS` when editing that app. Versioned build inputs live in `workflows/host/base-workflow.yml` and `workflows/host/src/`. Generated DSL goes to the ignored project `tmp/dify-import/` directory. The validator is `scripts/validate-dsl.py`; build and validation commands are documented in `docs/DIFY_CHATFLOW_INTEGRATION.md` at the project root. Do not edit old temporary Python copies as the canonical source.

`scripts/push-chatflow-draft.mjs` is a direct draft updater with expected-hash checks and read-back verification. It uses the locally configured console/CSRF credentials; unlike the MCP connector it does not automatically refresh expired credentials.

## Tools

- `get_workflow`: read a draft graph/hash.
- `preview_workflow_update`: compare a DSL graph to the draft without writing.
- `update_workflow`: save a graph to an existing draft with stale-hash protection.
- `create_workflow`: create from DSL through Dify's console import endpoint.
- `run_workflow`: invoke a published workflow using the app's service API key.

The draft management endpoints are Dify Console APIs and require an authenticated console access token and edit permission. The app API key does not grant workflow editing privileges. This is a local helper built against the Dify 1.17.1 Cloud API shape; Dify may change its console API without notice.
