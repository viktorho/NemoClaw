# AI Assistant Chatbox API Scope

This file tracks the current API scope for `AI Assistant` v1.

The current GUI direction is:

- one `always-on-top` desktop window
- `chat` as the main interaction surface
- a compact embedded `7-day calendar` inside the same window
- no separate planner dashboard for now

## Window Scope

The single desktop window should support:

- sending and receiving chat messages
- uploading screenshots as evidence
- viewing the upcoming week schedule
- approving or rejecting assistant proposals
- acknowledging or snoozing reminders
- staying always on top

## Required API Categories

## 1. Chat

These APIs power the chatbox itself.

- `POST /chat/session`
  - create or resume a chat session
- `GET /chat/session/:sessionId/messages`
  - load chat history for the current window
- `POST /chat/session/:sessionId/message`
  - send a user message
- `GET /chat/session/:sessionId/stream`
  - stream assistant replies, tool progress, reminder nudges, and proposal alerts

## 2. Calendar / Schedule

These APIs are required because the same window must display the upcoming week.

- `GET /schedule/week`
  - fetch the current 7-day schedule
- `POST /schedule/generate`
  - generate or refresh a schedule proposal
- `GET /proposals`
  - fetch pending proposals tied to scheduling or completion
- `POST /schedule/proposals/:id/approve`
  - approve a schedule-related proposal
- `POST /schedule/proposals/:id/reject`
  - reject a schedule-related proposal

## 3. Tasks

These APIs let the assistant create, inspect, and update tasks from chat.

- `POST /tasks`
  - create a task or goal
- `GET /tasks`
  - fetch current tasks for context and calendar rendering
- `GET /tasks/:id`
  - fetch a single task
- `POST /tasks/:id/breakdown`
  - break a task into subtasks
- `POST /tasks/:id/status`
  - update task status
- `POST /tasks/:id/priority`
  - update task priority

## 4. Evidence

These APIs support manual screenshot upload and analysis.

- `POST /evidence`
  - upload a screenshot from the desktop window
- `POST /evidence/:id/analyze`
  - analyze the uploaded screenshot
- `GET /evidence/:id`
  - fetch the analyzed evidence result

## 5. Reminders

These APIs let the chatbox surface reminders and accept user actions.

- `GET /reminders`
  - fetch upcoming and recent reminder state
- `POST /reminders/ack`
  - acknowledge a reminder
- `POST /reminders/snooze`
  - snooze a reminder

## 6. Desktop / App State

These APIs control the desktop window behavior and startup state.

- `GET /settings`
  - fetch app settings
- `POST /settings`
  - update app settings
- `GET /desktop/state`
  - fetch desktop window state
- `POST /desktop/state`
  - update desktop window state such as `alwaysOnTop`
- `GET /health`
  - backend health check

## Required API Set

This is the locked v1 API list for the current GUI scope.

```text
POST /chat/session
GET /chat/session/:sessionId/messages
POST /chat/session/:sessionId/message
GET /chat/session/:sessionId/stream

GET /schedule/week
POST /schedule/generate
GET /proposals
POST /schedule/proposals/:id/approve
POST /schedule/proposals/:id/reject

POST /tasks
GET /tasks
GET /tasks/:id
POST /tasks/:id/breakdown
POST /tasks/:id/status
POST /tasks/:id/priority

POST /evidence
POST /evidence/:id/analyze
GET /evidence/:id

GET /reminders
POST /reminders/ack
POST /reminders/snooze

GET /settings
POST /settings
GET /desktop/state
POST /desktop/state
GET /health
```

## Out Of Scope For This Window

These are not part of the current GUI requirement:

- separate planner dashboard
- separate proposal management page
- full evidence history browser
- recurring external calendar sync UI
- background screenshot capture
- multi-user features

## Current Product Interpretation

The app should now be treated as:

- one desktop window only
- chat-first
- week-calendar-aware
- screenshot-aware
- reminder-aware
- approval-based for schedule changes and completion suggestions
