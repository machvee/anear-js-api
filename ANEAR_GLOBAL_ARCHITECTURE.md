# Anear JS API - Architectural Overview

> **Note**: For additional context about the broader Anear ecosystem, including backend services, browser integration, and overall system architecture, please refer to `ANEAR_GLOBAL_ARCHITECTURE.md`.

## System Purpose
The anear-js-api is a runtime SDK that enables app developers to create real-time interactive events without needing to understand the underlying complexity of Ably.io interactions, event lifecycle management, and participant/spectator coordination.

## Core Architecture Components

### 1. State Machine Hierarchy
```
AnearCoreServiceMachine (Root)
├── AnearEventMachine (Per Event)
│   ├── AnearParticipantMachine (Per Participant)
│   └── AppEventMachine (Developer's App Logic)
└── AppParticipantMachine (Optional, Per Participant)
```

### 2. Key State Machines

#### AnearCoreServiceMachine
- **Purpose**: Highest-level parent state machine managing realtime messaging and event lifecycle
- **Responsibilities**:
  - Initialize Ably.io realtime messaging
  - Manage multiple concurrent events via `anearEventMachines` object
  - Handle app data fetching and asset uploads (CSS, images)
  - Load and compile PUG templates
  - Listen for `CREATE_EVENT` messages from backend via Ably REST API
- **Key States**: `waitForContextUpdate` → `fetchAppDataWithRetry` → `initRealtimeMessaging` → `waitAnearEventLifecycleCommand`

### Event Creation Flow (Enhanced)
1. **User Action**: Mobile client clicks on Global App or Zoned App
2. **Backend Processing**: ANAPI creates event record with:
   - Slug generation for URL-friendly identifiers
   - QR code creation for event discovery (except cloned events)
   - Location setting based on user/zone location
   - Permission validation (zone access, user status)
3. **Event Publishing**: ANAPI publishes `CREATE_EVENT` message via Ably REST API
4. **JS-API Reception**: anear-js-api receives message and begins processing

#### AnearEventMachine
- **Purpose**: Manages individual event lifecycle and participant coordination
- **Responsibilities**:
  - Handle event lifecycle states: `created` → `announce` → `live` → `closed`
  - Route messages between participants and app logic
  - Manage participant presence (enter/leave/exit)
  - Coordinate display rendering for all channels
  - Handle individual participant timeouts
  - **Note**: Group timeout logic for coordinating all participants is still TBD
- **Key States**: `registerCreator` → `eventCreated` → `announce` → `live` → `closeEvent`

#### AnearParticipantMachine
- **Purpose**: Manages individual participant state and private communications
- **Responsibilities**:
  - Handle participant private channel communications
  - Manage participant timeouts and reconnection logic
  - Track participant activity and idle states
  - Route participant-specific actions to app logic
- **Key States**: `setup` → `live` → `waitReconnect` → `cleanupAndExit`

### 3. Channel Architecture

#### Ably.io Channels
- **`eventChannel`**: Event control messages
- **`actionsChannel`**: Participant presence events + ACTION clicks
- **`participantsDisplayChannel`**: Group display messages for all participants
- **`spectatorsDisplayChannel`**: Display messages for all spectators
- **`privateChannel`**: Individual participant private displays (per participant)
  - Channel name received by anear-browser when participant JOINS event
  - AnearEventMachine retrieves private channel name via ANAPI when processing PARTICIPANT_ENTER
  - Only publishers and subscribers have access permissions to attach to private channels

#### Message Flow
1. **Presence Events**: Ably presence API → `actionsChannel` → XState events
2. **Action Events**: Participant clicks → `actionsChannel` → App logic
3. **Display Events**: App state transitions → `MetaProcessing` → Channel rendering

### 4. Integration Points

#### App Developer Integration
- **Factory Functions**: `appEventMachineFactory`, `appParticipantMachineFactory`
- **Event Reception**: `PARTICIPANT_ENTER`, `ACTION`, `PARTICIPANT_TIMEOUT`, etc.
- **Display Control**: XState `meta` properties define templates and timeouts
- **Context Access**: Rich context passed to PUG templates for flexible rendering
- **Automatic Integration**: `MetaProcessing` callback automatically wired to `AppEventMachine.onTransition`

#### MetaProcessing Integration
- **Purpose**: Translates XState state transitions into display events
- **Trigger**: Automatically wired to `AppEventMachine.onTransition`
- **Function**: Parses `meta` properties and sends `RENDER_DISPLAY` events
- **Output**: Display events with template paths and app context

### 5. Event Lifecycle Management

#### Event Types
- **Game Events**: Structured events with beginning/middle/end (trivia, competitions)
- **Open House Events**: Extended events with free participant entry/exit

#### State Transitions
- **`created`**: Creator/host setup phase (not for participants)
  - Creator can be a full participant OR a host (like an emcee with private display)
  - Hosts receive private displays but don't get participant display events
- **`announce`**: Join window for participants (spectators can become participants)
- **`live`**: Active gameplay or open participation
- **`closed`**: Event termination

### 6. Timeout Management

#### Individual Timeouts
- **Purpose**: Handle participant turn-based actions
- **Management**: `AnearParticipantMachine` tracks and notifies app
- **Configuration**: Dynamic via `timeoutFn` in XState meta
- **Example**: MetaProcessing iterates through all participants, calling timeoutFn for each:
  ```javascript
  timeout: (appContext, participantId) => {
    return appContext.currentPlayerId === participantId ? 30000 : 0;
  }
  ```

#### Group Timeouts
- **Purpose**: Coordinate all participants (e.g., trivia questions)
- **Management**: `AnearEventMachine` tracks all participants
- **Output**: `ACTION_TIMEOUT` event with failed participant IDs
- **Status**: Implementation still TBD - will track participant responses and send timeout events

### 7. Template System

#### PUG Templates
- **Location**: `/views` directory in app source code (`DefaultTemplatesRootDir = "./views"`)
- **Compilation**: Server-side compilation by `AnearCoreServiceMachine` during initialization
- **Rendering**: Server-side rendering triggered by state transitions
- **Context**: Rich context including app state, participants, timeouts

#### Display Types
- **`participants`**: Group display for all participants
- **`participant`**: Individual participant display
- **`spectators`**: Spectator-only display

### 8. Error Handling & Recovery

#### Participant Recovery
- **Disconnect Window**: 60-second reconnection window
- **State Restoration**: Automatic state restoration for temporary disconnections
- **Explicit Exit**: Participant can explicitly leave with context

#### System Recovery
- **Minimal Error Handling**: Currently basic error messages and exit
- **Room for Improvement**: Error handling is an area for enhancement

### 9. Scaling Considerations

#### Resource Limits
- **Concurrent Events**: Dozens of independent events per core service
- **Limiting Factors**: Process memory, network connections, Ably service limits
- **Management**: `anearEventMachines` object tracks all active events

#### Performance
- **Deferred States**: Prevent XState events from interrupting Promise invoke services during async operations
- **Channel Management**: Efficient Ably channel attachment/detachment
- **Template Caching**: Pre-compiled PUG templates for performance

## Key Benefits

1. **Abstraction**: Hides Ably.io complexity from app developers
2. **Declarative**: XState meta properties define display behavior
3. **Flexible**: Rich context system enables dynamic content
4. **Scalable**: Handles multiple concurrent events efficiently
5. **Reliable**: Built-in reconnection and timeout management
6. **Consistent**: XState-based architecture throughout

This architecture successfully separates infrastructure concerns from application logic, allowing app developers to focus on their specific use cases while the anear-js-api handles all the complex real-time event management. 

### Guest User Flow
Guest users are a core feature enabling immediate participation without registration barriers.

#### Guest User Creation
1. **Automatic Creation**: When no auth token is provided, ANAPI automatically creates guest user
2. **Temporary Identity**: Guest users receive temporary names (e.g., "Guest1234")
3. **Quick Participation**: Guests can immediately participate in events
4. **Token Management**: Guest tokens expire in 7 days (configurable)

#### Guest User Persistence
1. **Cookie Storage**: Guest identity stored in mobile browser cookies
2. **Account Reclamation**: Expired guest accounts can be reclaimed via cookie
3. **Data Accumulation**: Guests can accumulate points, achievements, and status
4. **Conversion Path**: Guest data transfers to registered account upon conversion

#### Guest User Coordination
1. **JS API Integration**: Guest users participate normally in state machines
2. **Display Rendering**: Guest participants receive same display events as registered users
3. **Permission Handling**: Guest users have same participation permissions as registered users
4. **Conversion Trigger**: Guest-to-registered conversion can be triggered during event participation

#### Guest User Benefits
- **Zero Friction**: Immediate participation without registration
- **Data Preservation**: Accumulated data transfers to registered account
- **Seamless Experience**: No difference in functionality between guest and registered users
- **Conversion Incentive**: Accumulated data provides incentive to register

## **6. Ably Permissions Clarification**

You're right that the Ably permissions are subsystem-specific and don't need detailed treatment in the global architecture document. The key point is that each subsystem (Rails API, JS API, mobile clients) has the appropriate permissions for their role in the message pipeline.

## **Remaining Questions for Clarity**

1. **Participant State Coordination**: How do the Rails API participant states (`active`, `expired`, etc.) coordinate with the JS API's `AnearParticipantMachine` states? Are they synchronized or independent?

2. **Timeout Management**: How do the Rails API's participant limits and timeouts interact with the JS API's timeout management? Is there a handoff or coordination mechanism?

3. **Geolocation Integration**: How does the Rails API's geolocation system (participation radius, nearby discovery) coordinate with the JS API's display rendering?

These clarifications would help complete the picture of how the Rails API and JS API work together in the ecosystem. 