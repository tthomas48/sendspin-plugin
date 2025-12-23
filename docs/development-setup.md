# Development Setup

## Node.js Version Management

This project uses **nvm** (Node Version Manager) to ensure consistent Node.js versions.

### Volumio Environment

- **Volumio Node.js Version**: v20.5.1
- **Project Node.js Version**: 20 (specified in `.nvmrc`)

### Setup for Development

1. **Install/use correct Node version:**
   ```bash
   # nvm will auto-detect from .nvmrc
   source ~/.nvm/nvm.sh
   nvm use
   ```

2. **Verify version:**
   ```bash
   node --version  # Should show v20.x.x
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

### Using nvm in Scripts

The project includes `.nvmrc` file which nvm automatically detects. When you `cd` into the project directory and run `nvm use`, it will switch to Node 20.

For automated scripts, you can use:
```bash
source ~/.nvm/nvm.sh && nvm use && npm test
```

### Package.json Scripts

All npm scripts assume you're using the correct Node version. The scripts don't include nvm commands to avoid issues in CI/CD environments where nvm might not be available.

**Before running any npm script:**
```bash
source ~/.nvm/nvm.sh && nvm use
```

Or add to your shell profile:
```bash
# Auto-use nvm when entering directory (optional)
autoload -U add-zsh-hook  # For zsh
load-nvmrc() {
  if [[ -f .nvmrc && -r .nvmrc ]]; then
    nvm use
  fi
}
add-zsh-hook chpwd load-nvmrc
```

## Requirements

- Node.js >= 18.0.0 (project uses 20 to match Volumio)
- npm
- nvm (recommended)

## Testing

```bash
# Ensure correct Node version
source ~/.nvm/nvm.sh && nvm use

# Run tests
npm test
```

## Building

```bash
# Ensure correct Node version
source ~/.nvm/nvm.sh && nvm use

# Build submodule
npm run build-sendspin
```



