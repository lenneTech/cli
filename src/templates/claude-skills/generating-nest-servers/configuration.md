---
name: nest-server-generator-configuration
version: 1.0.0
description: Complete guide to lt.config.json configuration file
---

# Configuration Guide

## Table of Contents
- [Configuration File (lt.config.json)](#configuration-file-ltconfigjson)
- [Command Syntax Reference](#command-syntax-reference)

## Configuration File (lt.config.json)

The lenne.tech CLI supports project-level configuration via `lt.config.json` files. This allows you to set default values for commands, eliminating the need for repeated CLI parameters or interactive prompts.

### File Location and Hierarchy

- **Location**: Place `lt.config.json` in your project root or any parent directory
- **Hierarchy**: The CLI searches from the current directory up to the root, merging configurations
- **Priority** (lowest to highest):
  1. Default values (hardcoded in CLI)
  2. Config from parent directories (higher up = lower priority)
  3. Config from current directory
  4. CLI parameters (`--flag value`)
  5. Interactive user input

### Configuration Structure

```json
{
  "meta": {
    "version": "1.0.0",
    "name": "My Project",
    "description": "Optional project description"
  },
  "commands": {
    "server": {
      "module": {
        "controller": "Both",
        "skipLint": false
      },
      "object": {
        "skipLint": false
      },
      "addProp": {
        "skipLint": false
      }
    }
  }
}
```

### Available Configuration Options

**Server Module Configuration (`commands.server.module`)**:
- `controller`: Default controller type (`"Rest"` | `"GraphQL"` | `"Both"` | `"auto"`)
- `skipLint`: Skip lint prompt after module creation (boolean)

**Server Object Configuration (`commands.server.object`)**:
- `skipLint`: Skip lint prompt after object creation (boolean)

**Server AddProp Configuration (`commands.server.addProp`)**:
- `skipLint`: Skip lint prompt after adding property (boolean)

### Using Configuration in Commands

**Example 1: Configure controller type globally**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "Rest"
      }
    }
  }
}
```

Now all `lt server module` commands will default to REST controllers:
```bash
# Uses "Rest" from config (no prompt)
lt server module --name Product --prop-name-0 name --prop-type-0 string
```

**Example 2: Override config with CLI parameter**
```bash
# Ignores config, uses GraphQL
lt server module --name Product --controller GraphQL
```

**Example 3: Auto-detect from config**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "auto"
      }
    }
  }
}
```

Now the CLI will auto-detect controller type from existing modules without prompting.

### Managing Configuration

**Initialize configuration**:
```bash
lt config init
```

**Show current configuration** (merged from all hierarchy levels):
```bash
lt config show
```

**Get help**:
```bash
lt config help
```

### When to Use Configuration

**✅ Use configuration when:**
- Creating multiple modules with the same controller type
- Working in a team with agreed-upon conventions
- Automating module generation in CI/CD
- You want to skip repetitive prompts

**❌ Don't use configuration when:**
- Creating a single module with specific requirements
- Each module needs a different controller type
- You're just testing or experimenting

### Best Practices

1. **Project Root**: Place `lt.config.json` in your project root
2. **Version Control**: Commit the config file to share with your team
3. **Documentation**: Add a README note explaining the config choices
4. **Override When Needed**: Use CLI parameters to override for special cases

### 🎯 IMPORTANT: Configuration After Server Creation

**CRITICAL WORKFLOW**: After creating a new server with `lt server create`, you **MUST** initialize the configuration file to set project conventions.

#### Automatic Post-Creation Setup

When you create a new NestJS server, immediately follow these steps:

1. **Navigate to the API directory**:
   ```bash
   cd projects/api
   ```

2. **Create the configuration file manually**:
   ```bash
   # Create lt.config.json with controller preference
   ```

3. **Ask the developer for their preference** (if not already specified):
   ```
   What controller type do you prefer for new modules in this project?
   1. Rest - REST controllers only
   2. GraphQL - GraphQL resolvers only
   3. Both - Both REST and GraphQL
   4. auto - Auto-detect from existing modules
   ```

4. **Write the configuration** based on the answer:
   ```json
   {
     "meta": {
       "version": "1.0.0"
     },
     "commands": {
       "server": {
         "module": {
           "controller": "Rest"
         }
       }
     }
   }
   ```

#### Why This Is Important

- ✅ **Consistency**: All modules will follow the same pattern
- ✅ **No Prompts**: Developers won't be asked for controller type repeatedly
- ✅ **Team Alignment**: Everyone uses the same conventions
- ✅ **Automation**: Scripts and CI/CD can create modules without interaction

#### Example Workflow

```bash
# User creates new server
lt server create --name MyAPI

# You (Claude) navigate to API directory
cd projects/api

# You ask the user
"I've created the server. What controller type would you like to use for modules?"
"1. Rest (REST only)"
"2. GraphQL (GraphQL only)"
"3. Both (REST + GraphQL)"
"4. auto (Auto-detect)"

# User answers: "Rest"

# You create lt.config.json
{
  "meta": {
    "version": "1.0.0"
  },
  "commands": {
    "server": {
      "module": {
        "controller": "Rest"
      }
    }
  }
}

# Confirm to user
"✅ Configuration saved! All new modules will default to REST controllers."
"You can change this anytime by editing lt.config.json or running 'lt config init'."
```

#### Configuration Options Explained

**"Rest"**:
- ✅ Creates REST controllers (`@Controller()`)
- ❌ No GraphQL resolvers
- ❌ No PubSub integration
- **Best for**: Traditional REST APIs, microservices

**"GraphQL"**:
- ❌ No REST controllers
- ✅ Creates GraphQL resolvers (`@Resolver()`)
- ✅ Includes PubSub for subscriptions
- **Best for**: GraphQL-first APIs, real-time apps

**"Both"**:
- ✅ Creates REST controllers
- ✅ Creates GraphQL resolvers
- ✅ Includes PubSub
- **Best for**: Hybrid APIs, gradual migration

**"auto"**:
- 🤖 Analyzes existing modules
- 🤖 Detects pattern automatically
- 🤖 No user prompt
- **Best for**: Following existing conventions

#### When NOT to Create Config

Skip config creation if:
- ❌ User is just testing/experimenting
- ❌ User explicitly says "no configuration"
- ❌ Project already has lt.config.json

### Integration with Commands

When generating code, **ALWAYS check for configuration**:
1. Load config via `lt config show` or check for `lt.config.json`
2. Use configured values in command construction
3. Only pass CLI parameters when overriding config

**Example: Generating module with config**
```bash
# Check if config exists and what controller type is configured
# If config has "controller": "Rest", use it
lt server module --name Product --prop-name-0 name --prop-type-0 string

# If config has "controller": "auto", let CLI detect
lt server module --name Order --prop-name-0 total --prop-type-0 number

# Override config when needed
lt server module --name User --controller Both
```

## Command Syntax Reference
