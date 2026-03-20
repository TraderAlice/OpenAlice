## Purpose

Provide a web UI page for managing cron jobs — listing, creating, editing, enabling/disabling, triggering, and deleting scheduled jobs. Complements the existing backend cron API routes (`/api/cron/jobs`) and the AI-facing cron tools, giving the user a visual dashboard for all scheduled tasks including heartbeat, market briefings, and trading signal monitors.

## Requirements

### Requirement: CronPage route and sidebar entry
The Cron Jobs page SHALL be registered as a new route in `ui/src/App.tsx`:
- Page type: `'cron'`
- Route path: `/cron`
- Component: `CronPage` from `ui/src/pages/CronPage.tsx`

The sidebar (`ui/src/components/Sidebar.tsx`) SHALL include a "Cron Jobs" navigation item with a clock icon, positioned after the Heartbeat entry.

#### Scenario: Navigation to Cron page
- **WHEN** the user clicks "Cron Jobs" in the sidebar
- **THEN** the app SHALL navigate to `/cron` and render `CronPage`

#### Scenario: Active state in sidebar
- **WHEN** the current path is `/cron`
- **THEN** the "Cron Jobs" nav item SHALL display with the active indicator (accent bar + highlighted text)

### Requirement: Job list display
`CronPage` SHALL fetch all cron jobs from `api.cron.list()` on mount and display them as cards. Each job card SHALL show:
- Job name (with "Heartbeat" display for `__heartbeat__` jobs)
- Status badge: green "OK" for last successful run, red "Error (Nx)" for consecutive errors, gray "Never run" for new jobs
- Schedule label: human-readable format (e.g. `every 4h`, `0 9 * * 1-5`, `once @ 2026-04-01T09:00:00Z`)
- Job ID
- Next run time (relative + absolute)
- Last run time (absolute)
- Collapsible payload preview showing the full prompt text

#### Scenario: Jobs loaded and displayed
- **WHEN** the CronPage mounts
- **THEN** all jobs from `/api/cron/jobs` SHALL be displayed as cards

#### Scenario: Heartbeat job shown separately
- **WHEN** a job with `name: '__heartbeat__'` exists
- **THEN** it SHALL be displayed first, with a "system" badge and "Heartbeat" as the display name

#### Scenario: Disabled jobs visually distinct
- **WHEN** a job has `enabled: false`
- **THEN** the card SHALL render with reduced opacity (60%)

### Requirement: Toggle enable/disable
Each job card SHALL include a `Toggle` component that enables or disables the job via `api.cron.update(id, { enabled })`. The job list SHALL refresh after toggling.

#### Scenario: Disable a job
- **WHEN** the user toggles a job from enabled to disabled
- **THEN** `PUT /api/cron/jobs/:id` SHALL be called with `{ enabled: false }` and the list SHALL reload

### Requirement: Run Now button
Each job card SHALL include a "Run" button that triggers immediate execution via `api.cron.runNow(id)`. The button SHALL show a loading state while the request is in flight and display a "Job triggered!" feedback message on success.

#### Scenario: Manual trigger
- **WHEN** the user clicks "Run" on a job
- **THEN** `POST /api/cron/jobs/:id/run` SHALL be called, triggering the job immediately

### Requirement: Delete with confirmation
Non-heartbeat job cards SHALL include a delete button (trash icon). Clicking it SHALL show inline "Yes" / "No" confirmation buttons. Confirming SHALL call `api.cron.remove(id)` and refresh the list. The heartbeat job SHALL NOT have a delete button.

#### Scenario: Delete confirmed
- **WHEN** the user clicks delete then confirms
- **THEN** `DELETE /api/cron/jobs/:id` SHALL be called and the job SHALL disappear from the list

#### Scenario: Delete cancelled
- **WHEN** the user clicks delete then clicks "No"
- **THEN** the confirmation UI SHALL dismiss without any API call

### Requirement: Create/Edit modal
The page SHALL include a "New Job" button (in the page header) and "Edit" buttons on each non-heartbeat card. Both SHALL open a modal form with the following fields:
- **Name** (text input, required)
- **Schedule Type** (select: Cron 5-field / Interval / One-shot)
- **Schedule Value** (text input with placeholder matching the selected type)
- **Channel** (select: Default / Telegram / Web)
- **Payload** (textarea, monospace, min 200px height, required)
- **Enabled** (toggle)

The modal SHALL close on backdrop click, the X button, or the Cancel button. On submit, it SHALL call `api.cron.add()` for new jobs or `api.cron.update()` for edits, then refresh the list.

#### Scenario: Create new job
- **WHEN** the user fills the form and clicks "Create"
- **THEN** `POST /api/cron/jobs` SHALL be called with the form data and the new job SHALL appear in the list

#### Scenario: Edit existing job
- **WHEN** the user edits a job and clicks "Update"
- **THEN** `PUT /api/cron/jobs/:id` SHALL be called with the changed fields

#### Scenario: Validation
- **WHEN** the user submits with empty name, schedule, or payload
- **THEN** the form SHALL display an error message and NOT call the API

### Requirement: Recent cron events
The page SHALL include a "Recent Cron Events" section that fetches the last 500 event log entries, filters to `cron.*` types, and displays the most recent 30 in a table with columns:
- Time (formatted date + time)
- Type (fire / done / error, color-coded: green for done, red for error, purple for fire)
- Job name
- Details (duration for done events, error message for error events)

#### Scenario: Events displayed
- **WHEN** the CronPage loads and cron events exist in the event log
- **THEN** the events table SHALL show the most recent 30 cron-related events

#### Scenario: No events
- **WHEN** no cron events exist
- **THEN** the table SHALL show "No cron events yet"

### Requirement: API client
The UI SHALL use the existing `ui/src/api/cron.ts` module which provides:
- `cronApi.list()` → `GET /api/cron/jobs` → `{ jobs: CronJob[] }`
- `cronApi.add(params)` → `POST /api/cron/jobs` → `{ id: string }`
- `cronApi.update(id, patch)` → `PUT /api/cron/jobs/:id`
- `cronApi.remove(id)` → `DELETE /api/cron/jobs/:id`
- `cronApi.runNow(id)` → `POST /api/cron/jobs/:id/run`

The `CronJob` type is already defined in `ui/src/api/types.ts` with fields: `id`, `name`, `enabled`, `schedule` (CronSchedule), `payload`, `state` (CronJobState), `createdAt`.

### Requirement: Consistent design system
The CronPage SHALL use the same UI components as other pages:
- `PageHeader` for title bar with job count and action buttons
- `Section` / `Card` containers from `ui/src/components/form.tsx`
- `Toggle` from `ui/src/components/Toggle.tsx`
- `inputClass` for form inputs
- Standard color tokens (`text`, `text-muted`, `bg`, `bg-secondary`, `bg-tertiary`, `border`, `accent`, `green`, `red`, `purple`)

#### Scenario: Visual consistency
- **WHEN** the CronPage is rendered alongside other pages (Heartbeat, Settings, etc.)
- **THEN** the styling SHALL be visually consistent with the rest of the application
