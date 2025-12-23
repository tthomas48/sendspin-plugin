# Forking sendspin-js Analysis

## Feasibility Assessment

### What Would Need to Be Added

#### 1. WebSocket Server (New Component)
**Current**: `WebSocketManager` - Client only (connects TO servers)
**Needed**: `WebSocketServerManager` - Server that listens for connections

**Complexity**: ⭐⭐ Medium
- Need to use Node.js `ws` library (not browser WebSocket API)
- Handle multiple concurrent connections
- Connection lifecycle management
- ~200-300 lines of code

#### 2. Server Protocol Handler (New Component)
**Current**: `ProtocolHandler` - Receives SERVER messages, sends CLIENT messages
**Needed**: `ServerProtocolHandler` - Sends SERVER messages, receives CLIENT messages

**Complexity**: ⭐⭐⭐ Medium-High
- Reverse the message flow
- Handle CLIENT_HELLO, CLIENT_TIME, CLIENT_STATE
- Send SERVER_HELLO, SERVER_TIME, SERVER_STATE, SERVER_COMMAND
- Manage multiple client connections
- Time synchronization (server side)
- ~300-400 lines of code

#### 3. Server Class (New Export)
**Current**: `SendspinPlayer` - Client/player class
**Needed**: `SendspinServer` - Server class

**Complexity**: ⭐⭐ Medium
- Orchestrate WebSocketServer + ServerProtocolHandler
- Manage client connections
- Handle audio stream transmission
- ~150-200 lines of code

#### 4. Device Discovery (New Component)
**Current**: None
**Needed**: mDNS/SSDP advertising

**Complexity**: ⭐⭐⭐ Medium
- Use `bonjour` or `mdns` npm package
- Advertise Sendspin service
- Handle service discovery
- ~100-150 lines of code

#### 5. Audio Stream Transmission (Modify/Add)
**Current**: `AudioProcessor` - Receives and plays audio
**Needed**: Audio stream source and transmission

**Complexity**: ⭐⭐⭐⭐ High
- Need to get audio FROM Volumio
- Encode to Opus/FLAC/PCM
- Transmit to connected clients
- Synchronize across multiple clients
- This is the most complex part

### Total Estimated Complexity

| Component | Lines of Code | Complexity | Reusability |
|-----------|---------------|------------|-------------|
| WebSocket Server | 200-300 | Medium | Low (new) |
| Server Protocol Handler | 300-400 | Medium-High | Medium (can reference client) |
| Server Class | 150-200 | Medium | Low (new) |
| Device Discovery | 100-150 | Medium | Low (new) |
| Audio Transmission | 400-600 | High | Low (new, different direction) |
| **Total** | **1150-1650** | **Medium-High** | **Medium** |

### What Can Be Reused

✅ **Types** (`types.ts`) - 100% reusable
✅ **Protocol Message Structures** - 100% reusable  
✅ **Time Filter Logic** - Can be adapted for server-side
✅ **State Management Patterns** - Can be adapted
⚠️ **Audio Processing** - Different direction (transmit vs receive)
❌ **WebSocket Manager** - Client-only, need new server version
❌ **Protocol Handler** - Client-only, need server version

## Fork vs Custom Implementation

### Forking sendspin-js: Pros

✅ **Reuse existing code** - Types, structures, patterns
✅ **Maintain protocol compatibility** - Same message formats
✅ **Learn from existing implementation** - Well-tested patterns
✅ **Potential upstream contribution** - Could contribute back
✅ **TypeScript types** - Already defined
✅ **Small codebase** - Only 8 source files, manageable

### Forking sendspin-js: Cons

❌ **Maintenance burden** - Need to keep fork in sync with upstream
❌ **Breaking changes risk** - Upstream changes might break fork
❌ **Different architecture** - Server is quite different from client
❌ **Browser dependencies** - Some code assumes browser environment
❌ **Testing complexity** - Need to test both client and server

### Custom Implementation: Pros

✅ **Full control** - No upstream dependencies
✅ **Simpler** - Only implement what we need
✅ **Volumio-specific** - Optimized for our use case
✅ **No sync burden** - Independent codebase

### Custom Implementation: Cons

❌ **More code to write** - Start from scratch
❌ **More testing** - Need to test protocol implementation
❌ **Potential bugs** - Reinventing the wheel

## Workspace Integration Options

### Option 1: Git Submodule
```bash
git submodule add https://github.com/your-username/sendspin-js.git lib/sendspin-js
```

**Pros**: 
- Keeps fork separate
- Easy to update
- Clear separation

**Cons**:
- Submodule complexity
- Volumio plugin structure might not support it well

### Option 2: npm link / Local Path
```json
{
  "dependencies": {
    "@music-assistant/sendspin-js": "file:../sendspin-js"
  }
}
```

**Pros**:
- Standard npm approach
- Easy development
- Works with Volumio plugin structure

**Cons**:
- Need to build the fork first
- Path management

### Option 3: Fork as Separate Repo, Publish to npm
```json
{
  "dependencies": {
    "@your-scope/sendspin-js-server": "^1.0.0"
  }
}
```

**Pros**:
- Clean separation
- Can be used by others
- Standard npm workflow

**Cons**:
- Need to publish to npm
- More setup

### Option 4: Copy Code into Plugin (Recommended for Volumio)
Just copy the relevant files into the plugin's `lib/` directory

**Pros**:
- Simple
- No external dependencies
- Works perfectly with Volumio plugin structure
- Can modify as needed

**Cons**:
- Code duplication
- Harder to update from upstream

## Recommendation

### Best Approach: **Fork + Copy Strategy**

1. **Fork sendspin-js** on GitHub
2. **Add server functionality** to the fork
3. **Copy modified code** into Volumio plugin's `lib/` directory
4. **Reference original** for updates if needed

**Rationale**:
- Volumio plugins work best with self-contained code
- No npm publishing needed
- Can still contribute back to upstream
- Full control over the code
- Easy to modify for Volumio-specific needs

### Implementation Plan

1. **Fork the repository**
   ```bash
   # Fork on GitHub first, then:
   git clone https://github.com/your-username/sendspin-js.git
   cd sendspin-js
   git remote add upstream https://github.com/Sendspin/sendspin-js.git
   ```

2. **Create server branch**
   ```bash
   git checkout -b add-server-support
   ```

3. **Add server components**
   - `src/websocket-server-manager.ts` - WebSocket server
   - `src/server-protocol-handler.ts` - Server protocol handling
   - `src/sendspin-server.ts` - Server class
   - `src/device-discovery.ts` - mDNS advertising
   - Modify `src/index.ts` to export server classes

4. **Copy to plugin**
   ```bash
   # From plugin directory
   cp -r ../sendspin-js/src/* lib/sendspin/
   # Or selectively copy what we need
   ```

5. **Modify for Volumio**
   - Remove browser-specific code
   - Add Volumio audio integration
   - Adapt for Node.js environment

## Estimated Effort

- **Forking and setup**: 1-2 hours
- **WebSocket server**: 4-6 hours
- **Server protocol handler**: 6-8 hours
- **Server class**: 3-4 hours
- **Device discovery**: 3-4 hours
- **Audio transmission**: 8-12 hours (most complex)
- **Testing and integration**: 6-8 hours
- **Total**: ~35-45 hours

## Conclusion

**Forking is definitely feasible and probably the best approach!**

The library is small enough to be manageable, and we can reuse a lot of the protocol implementation. The main work is:
1. Adding server-side WebSocket handling
2. Reversing the protocol message flow
3. Implementing audio transmission (the hardest part)

The fork + copy strategy gives us the best of both worlds: reuse existing code while maintaining full control for the Volumio plugin.

