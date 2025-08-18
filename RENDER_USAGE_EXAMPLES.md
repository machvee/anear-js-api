# Render Usage Examples

## Overview
Anear provides two approaches for rendering displays:

1. **`meta: {}` in states** - Automatic rendering on state transitions (convenient)
2. **`anearEvent.render()`** - Explicit rendering control (guaranteed)

## Meta: {} Approach (Automatic)

```javascript
const Config = {
  id: "tic-tac-toe",
  initial: 'live',
  states: {
    live: {
      initial: 'registration',
      states: {
        registration: {
          meta: {
            participants: 'ViewableGameBoard',
            spectators: 'ViewableGameBoard'
          }
        },
        gameInProgress: {
          meta: {
            participant: { 
              view: 'PlayableGameBoard', 
              timeout: calcParticipantTimeout 
            },
            spectators: 'ViewableGameBoard'
          }
        }
      }
    }
  }
}
```

**Benefits:**
- Set once, renders automatically on state transitions
- Clean separation of display logic from game logic
- Timeout functions work automatically for participant displays

## anearEvent.render() Approach (Explicit)

```javascript
// In your AppM actions or during shutdown
const actions = {
  // Render game over display during shutdown
  renderGameOver: (context, event) => {
    anearEvent.render(
      'GameOver',           // viewPath
      'participants',       // displayType
      context,              // appContext (AppM's context)
      event,                // event that triggered this render
      null,                 // timeout (null for no timeout)
      { winner: context.winningPlayerId } // additional props
    )
  },
  
  // Render with timeout for participant displays
  renderWithTimeout: (context, event) => {
    anearEvent.render(
      'WaitingForMove',
      'participant',
      context,
      event,
      (appContext, participantId) => 30000, // 30 second timeout
      { currentPlayer: context.currentPlayerToken }
    )
  },
  
  // Render for spectators
  renderForSpectators: (context, event) => {
    anearEvent.render(
      'GameStatus',
      'spectators',
      context,
      event,
      null, // no timeout for spectators
      { gameState: 'in_progress', playerCount: context.playerCount }
    )
  }
}
```

## Shutdown Rendering Example

```javascript
const actions = {
  // During game shutdown, render final displays
  handleGameEnd: (context, event) => {
    if (context.winner) {
      // Render winner display
      anearEvent.render(
        'WinnerDisplay',
        'participants',
        context,
        event,
        null,
        { 
          winner: context.winner,
          finalScore: context.score,
          gameDuration: context.gameDuration
        }
      )
    } else if (context.isTie) {
      // Render tie display
      anearEvent.render(
        'TieDisplay',
        'participants',
        context,
        event,
        null,
        { finalScore: context.score }
      )
    }
    
    // Now close the event
    anearEvent.closeEvent()
  }
}
```

## Parameter Details

### `anearEvent.render(viewPath, displayType, appContext, event, timeout, props)`

- **`viewPath`** (string): Template/view path to render (e.g., 'GameBoard', 'GameOver')
- **`displayType`** (string): One of 'participants', 'participant', or 'spectators'
- **`appContext`** (Object): The AppM's context object (available in scope)
- **`event`** (Object): The event that triggered this render (available in scope)
- **`timeout`** (Function|number|null): 
  - `null`: No timeout
  - `number`: Fixed timeout in milliseconds
  - `Function`: Dynamic timeout function `(appContext, participantId) => msecs`
- **`props`** (Object): Additional properties merged into meta (optional)

## When to Use Each Approach

### Use `meta: {}` when:
- Setting up initial display states
- Display logic is tied to game state
- You want automatic rendering on transitions
- Timeout functions are simple

### Use `anearEvent.render()` when:
- You need guaranteed rendering control
- Rendering during shutdown sequences
- Dynamic displays based on game events
- Complex timeout logic
- Rendering outside of state transitions

## Best Practices

1. **Use `meta: {}` for the main game flow** - keeps things simple
2. **Use `anearEvent.render()` for shutdown and dynamic updates** - gives you control
3. **Always pass the AppM context** - ensures proper data binding
4. **Use timeouts for participant displays** - prevents hanging displays
5. **Keep props minimal** - only add what's needed for the template
