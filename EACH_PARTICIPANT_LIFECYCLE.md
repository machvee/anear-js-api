# The `eachParticipant` Display Lifecycle

This document provides a detailed, step-by-by-step breakdown of how a display targeted at `eachParticipant` travels from the application's state machine (AppM) to an individual participant's browser client.

### The Goal

We want to render a specific view (`QuestionScreen.pug`) for a single user (`participant-123`) and make sure they answer within 10 seconds.

### The Big Picture

The core idea is to translate a declarative `meta` block in your application's state machine (AppM) into concrete HTML content that gets delivered to a specific participant's device. This process involves a chain of components:

`AppMachineTransition` -> `AnearEventMachine` -> `DisplayEventProcessor` -> `AnearParticipantMachine` -> **Ably Message**

Let's break down each step.

---

### Part 1: The Trigger (Your AppM & `AppMachineTransition.js`)

It all starts in your application-specific state machine (e.g., `anear-q-and-a/StateMachine.js`). When your machine enters a state that needs to display something to participants, you define a `meta` object.

**Context:** The `meta` object is how your AppM communicates rendering intentions to the Anear platform. The `AppMachineTransition` module is a subscriber that listens for *every* state change in your AppM. Its job is to parse that `meta` object and translate it into a standardized command for the rest of the system.

#### Code Example (Your AppM)
Imagine your Q&A machine enters the `askQuestion` state. The state definition would look like this:

```javascript
// anear-q-and-a/StateMachine.js
// ...
confirmMove: {
  meta: {
    // 'eachParticipant' is a function for selective rendering.
    // This example shows how to target a single participant based on the
    // event that triggered this state transition.
    eachParticipant: (appContext, event) => {
      // 'event' is the event that led to this state, e.g., { type: 'MOVE', participantId: 'p1', ... }
      const movingParticipantId = event.participantId;

      if (!movingParticipantId) return []; // Always return an array

      // We only want to send a display to the participant who just moved.
      return [{
        participantId: movingParticipantId,
        view: 'participant/MoveConfirmation', // A view confirming their move was received
        props: {
          message: 'Your move has been recorded. Waiting for opponent...',
          move: event.moveData
        },
        timeout: 2000 // A short timeout for the confirmation display
      }];
    }
  }
}
// ...
```

#### Lifecycle Step 1: Parsing the `meta` block

When your AppM transitions to `confirmMove`, the `AppMachineTransition` function is invoked.

*   **File:** `/Users/machvee/dev/anear-js-api/lib/utils/AppMachineTransition.js`
*   **Description:** It detects the `meta.eachParticipant` property. Since it's a function, it executes it, receiving the array of display instructions we defined above. It then iterates through that array. For each instruction, it creates a standardized "display event" object.
*   **Code Reference (`AppMachineTransition.js` lines 62-95):**

```javascript
// ... inside AppMachineTransition.js
if (meta.eachParticipant) {
  if (typeof meta.eachParticipant === 'function') {
    // This is our path: the selective rendering function
    const participantRenderFunc = meta.eachParticipant;
    const participantDisplays = participantRenderFunc(appContext, event); // Executes our function from the AppM

    // ... loops through the returned array ...
    participantDisplays.forEach(participantDisplay => {
      if (participantDisplay && participantDisplay.participantId && participantDisplay.view) {
        const timeout = participantDisplay.timeout || null;

        // Packages the info into a standard object
        displayEvent = RenderContextBuilder.buildDisplayEvent(
          participantDisplay.view,
          baseAppRenderContext,
          'eachParticipant',
          participantDisplay.participantId,
          timeout
        );
        displayEvents.push(displayEvent);
      }
    });
  } // ...
}
```

#### Lifecycle Step 2: Sending the Command

After processing all `meta` properties, `AppMachineTransition` bundles all the generated `displayEvent` objects into a single event and sends it to the `AnearEventMachine` (AEM).

*   **File:** `/Users/machvee/dev/anear-js-api/lib/utils/AppMachineTransition.js`
*   **Code Reference (lines 137-140):**

```javascript
if (displayEvents.length > 0) {
  // Sends one event with a list of all rendering jobs
  anearEvent.send('RENDER_DISPLAY', { displayEvents });
}
```

---

### Part 2: The Router (`AnearEventMachine.js`)

**Context:** The `AnearEventMachine` (AEM) is the central orchestrator for an event. When it receives the `RENDER_DISPLAY` event, its role isn't to render anything itself, but to delegate the task to a specialized processor.

#### Lifecycle Step 3: Delegation

The AEM enters a rendering state (e.g., `announceRendering` or `liveRendering`) and invokes its `renderDisplay` service.

*   **File:** `/Users/machvee/dev/anear-js-api/lib/state_machines/AnearEventMachine.js`
*   **Description:** This service is simple: it creates an instance of `DisplayEventProcessor` and tells it to handle the `displayEvents` array we sent in the previous step.
*   **Code Reference (lines 1144-1148):**

```javascript
// ... inside AnearEventMachine.js
services: {
  renderDisplay: async (context, event) => {
    // The event here contains our { displayEvents } payload
    const displayEventProcessor = new DisplayEventProcessor(context);
    return await displayEventProcessor.processAndPublish(event.displayEvents);
  },
// ...
```

---

### Part 3: The Processor (`DisplayEventProcessor.js`)

**Context:** This class is the workhorse. It knows how to handle different display targets (`allParticipants`, `spectators`, `host`, and our target, `eachParticipant`). It's responsible for compiling the Pug templates and figuring out *who* gets the final HTML.

#### Lifecycle Step 4: Processing and Routing the Display

The `DisplayEventProcessor` loops through each `displayEvent` and, based on the target, decides what to do.

*   **File:** `/Users/machvee/dev/anear-js-api/lib/utils/DisplayEventProcessor.js`
*   **Description:** For an `eachParticipant`