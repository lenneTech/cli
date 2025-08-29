# LT CLI Tool Reference

## Overview
The LT CLI is a globally installed code generation tool for TypeScript projects with server modules and objects. It provides commands for creating and modifying backend structures.

## Available Commands

### Create New Fullstack Workspace
**Command:** `lt fullstack init` (alias: `lt full init`)

**Purpose:** Creates a complete fullstack workspace with frontend (Angular/Nuxt), backend (NestJS), and proper project structure.

**Usage:**
```bash
# Interactive mode (prompts for all inputs)
lt fullstack init

# Non-interactive mode with CLI arguments
lt fullstack init --name <WorkspaceName> --frontend <angular|nuxt> --git <true|false> --git-link <GitURL>
```

**Arguments:**
- `--name` - Workspace name
- `--frontend` - Frontend framework: "angular" or "nuxt"
- `--git` - Initialize git repository: "true" or "false"
- `--git-link` - Git repository URL (required when --git is true)

**Examples:**
```bash
# Create workspace with Angular frontend, no git
lt fullstack init --name MyApp --frontend angular --git false

# Create workspace with Nuxt frontend and git repository
lt fullstack init --name MyProject --frontend nuxt --git true --git-link https://github.com/user/my-project.git

# Interactive mode (will prompt for inputs)
lt fullstack init
```

**What it creates:**
- Clones the lt-monorepo template from GitHub
- Sets up chosen frontend framework (Angular from ng-base-starter or Nuxt using create-nuxt-base)
- Integrates NestJS server starter from nest-server-starter
- Creates proper workspace structure with `/projects/app` and `/projects/api`
- Configures meta.json and environment files
- Replaces secret keys and project-specific configurations
- Optionally initializes git repository with dev branch and pushes to remote
- Installs all packages and runs initialization scripts

### Create New Server Module
**Command:** `lt server module` (alias: `lt server m`)

**Purpose:** Creates a complete new server module with all necessary files (model, service, controller, resolver, inputs, outputs).

**Usage:**
```bash
# Interactive mode (prompts for all inputs)
lt server module

# Non-interactive mode with CLI arguments
lt server module --name <ModuleName> --controller <Rest|GraphQL|Both> [property-flags]
```

**Arguments:**
- `--name` - Module name (required)
- `--controller` - Controller type: "Rest", "GraphQL", or "Both" (required)
- `--skipLint` - Skip lint fix prompt (optional)
- Property arguments (same as add-property command):
  - `--prop-name-X` - Property name (X = index: 0, 1, 2...)
  - `--prop-type-X` - Property type
  - `--prop-nullable-X` - "true" or "false" (default: false)
  - `--prop-array-X` - "true" or "false" (default: false)
  - `--prop-enum-X` - Enum type name
  - `--prop-schema-X` - Schema/object type name
  - `--prop-reference-X` - Reference type name for ObjectId properties

**Examples:**
```bash
# Create User module with REST controller only
lt server module --name User --controller Rest

# Create Post module with both REST and GraphQL, with properties
lt server module --name Post --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 content --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 author --prop-type-2 ObjectId --prop-reference-2 User

# Create Product module with GraphQL only and enum property
lt server module --name Product --controller GraphQL \
  --prop-name-0 status --prop-enum-0 ProductStatusEnum \
  --prop-name-1 price --prop-type-1 number

# Skip lint fix prompt
lt server module --name Category --controller Both --skipLint
```

**What it creates:**
- `<module-name>.model.ts` - MongoDB schema with Mongoose decorators
- `<module-name>.service.ts` - Business logic service
- `<module-name>.controller.ts` - REST controller (if Rest or Both)
- `<module-name>.resolver.ts` - GraphQL resolver (if GraphQL or Both)
- `<module-name>.module.ts` - NestJS module configuration
- `inputs/<module-name>.input.ts` - Input DTO for updates
- `inputs/<module-name>-create.input.ts` - Input DTO for creation
- `outputs/find-and-count-<module-name>s-result.output.ts` - Output DTO for pagination
- Automatically integrates the module into `server.module.ts`

### Add Properties to Modules/Objects
**Command:** `lt server addProp` (alias: `lt server ap`)

**Purpose:** Adds properties to existing modules or objects, updating model files, input files, and create input files automatically with UnifiedField decorators.

**Usage:**
```bash
# Interactive mode (prompts for all inputs)
lt server addProp

# Non-interactive mode with CLI arguments
lt server addProp --type <Module|Object> --element <name> [property-flags]
```

**Arguments:**
- `--type` - "Module" or "Object" (required)
- `--element` - Name of the module/object to modify (required)
- Property definitions (multiple properties supported):
  - `--prop-name-X` - Property name (X = index: 0, 1, 2...)
  - `--prop-type-X` - Property type (string, number, boolean, ObjectId, Json, etc.)
  - `--prop-nullable-X` - "true" or "false" (default: false)
  - `--prop-array-X` - "true" or "false" (default: false)
  - `--prop-enum-X` - Enum type name (e.g., "UserStatusEnum")
  - `--prop-schema-X` - Schema/object type name
  - `--prop-reference-X` - Reference type name for ObjectId properties

**Examples:**
```bash
# Add email and age properties to User module
lt server addProp --type Module --element User \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 age --prop-type-1 number --prop-nullable-1 true

# Add bio to Profile object
lt server addProp --type Object --element Profile \
  --prop-name-0 bio --prop-type-0 string --prop-nullable-0 true

# Add array of tags to Post module
lt server addProp --type Module --element Post \
  --prop-name-0 tags --prop-type-0 string --prop-array-0 true

# Add enum property to User module
lt server addProp --type Module --element User \
  --prop-name-0 status --prop-enum-0 UserStatusEnum

# Add ObjectId reference to Post module
lt server addProp --type Module --element Post \
  --prop-name-0 author --prop-type-0 ObjectId --prop-reference-0 User

# Add schema/object property to User module
lt server addProp --type Module --element User \
  --prop-name-0 profile --prop-schema-0 UserProfile

# Add JSON field for metadata
lt server addProp --type Module --element Product \
  --prop-name-0 metadata --prop-type-0 Json --prop-nullable-0 true
```

**What it does:**
- Adds properties to `.model.ts` with `@Prop()` and `@UnifiedField()` decorators
- Updates `.input.ts` with `@UnifiedField()` decorator for updates
- Updates `-create.input.ts` with `@UnifiedField()` decorator for creation
- Handles TypeScript typing with proper generics and suffixes
- Automatically handles references (ObjectId → Reference for model, ReferenceInput for input)
- Supports `useDefineForClassFields` TypeScript configuration
- Prompts for lint fix after completion
- Can cascade to create referenced modules/objects if they don't exist

### Create New Server Object
**Command:** `lt server object` (alias: `lt server o`)

**Purpose:** Creates a new server object (shared data structure) with input DTOs for use across modules.

**Usage:**
```bash
# Interactive mode (prompts for all inputs)
lt server object

# Non-interactive mode with CLI arguments
lt server object --name <ObjectName> [property-flags]
```

**Arguments:**
- `--name` - Object name (required)
- `--skipLint` - Skip lint fix prompt (optional)
- Property definitions (multiple properties supported):
  - `--prop-name-X` - Property name (X = index: 0, 1, 2...)
  - `--prop-type-X` - Property type (string, number, boolean, ObjectId, Json, etc.)
  - `--prop-nullable-X` - "true" or "false" (default: false)
  - `--prop-array-X` - "true" or "false" (default: false)
  - `--prop-enum-X` - Enum type name (e.g., "StatusEnum")
  - `--prop-schema-X` - Schema/object type name
  - `--prop-reference-X` - Reference type name for ObjectId properties

**Examples:**
```bash
# Create basic Address object
lt server object --name Address

# Create UserProfile object with properties
lt server object --name UserProfile \
  --prop-name-0 firstName --prop-type-0 string \
  --prop-name-1 lastName --prop-type-1 string \
  --prop-name-2 bio --prop-type-2 string --prop-nullable-2 true

# Create Contact object with array and reference
lt server object --name Contact \
  --prop-name-0 emails --prop-type-0 string --prop-array-0 true \
  --prop-name-1 owner --prop-type-1 ObjectId --prop-reference-1 User

# Create Settings object with enum and JSON
lt server object --name Settings \
  --prop-name-0 theme --prop-enum-0 ThemeEnum \
  --prop-name-1 preferences --prop-type-1 Json --prop-nullable-1 true

# Skip lint fix
lt server object --name Metadata --skipLint \
  --prop-name-0 tags --prop-type-0 string --prop-array-0 true
```

**What it creates:**
- `<object-name>.object.ts` - Object class with UnifiedField decorators
- `<object-name>.input.ts` - Input DTO for updates with validation
- `<object-name>-create.input.ts` - Input DTO for creation with validation
- All files in `src/server/common/objects/<object-name>/` directory

**What it does:**
- Creates reusable data structures that can be embedded in modules
- Adds properties with `@UnifiedField()` decorators for GraphQL/REST APIs
- Generates proper TypeScript typing with generics and suffixes
- Supports `useDefineForClassFields` TypeScript configuration
- Handles references (ObjectId → Reference for object, ReferenceInput for input)
- Can cascade to create referenced modules/objects if they don't exist
- Prompts for lint fix after completion (unless --skipLint is used)

## Project Structure Requirements
The LT CLI expects this file structure in your project:
```
src/
  server/
    modules/
      <ModuleName>/
        <ModuleName>.model.ts
        inputs/
          <ModuleName>.input.ts
          <ModuleName>-create.input.ts
    common/
      objects/
        <ObjectName>/
          <ObjectName>.object.ts
          <ObjectName>.input.ts
          <ObjectName>-create.input.ts
```

## Property Types Supported
- **Primitive:** string, number, boolean, bigint, null, undefined, etc.
- **Complex:** ObjectId (for references), JSON, custom schemas
- **Arrays:** Any type can be an array with `--prop-array-X true`
- **Nullable:** Any type can be nullable with `--prop-nullable-X true`
- **Enums:** Custom enum references

## What the Tool Does
1. Parses arguments or runs interactive prompts
2. Locates target files (model, input, create-input)
3. Adds properties with proper TypeScript decorators (@Prop, @UnifiedField)
4. Updates all relevant files maintaining proper structure
5. Formats code automatically
6. Optionally runs lint fixes
7. Handles cascading references and objects

## Usage Notes
- **IMPORTANT:** Run commands from anywhere within your project directory
- The CLI will locate the nearest `src/` directory above your current location and work from there
- The CLI automatically handles TypeScript decorators and proper formatting with ts-morph
- It maintains existing code structure and adds new properties appropriately  
- Interactive mode provides validation and helps with complex property types
- CLI mode is better for automation and scripting scenarios
- Both commands support cascading creation of referenced modules/objects
- The module command automatically integrates new modules into `server.module.ts`
- All commands offer optional lint fixing after completion
- Always backup your code before running, as it modifies files directly
- For fullstack init: Requires git to be installed and accessible via CLI
- Commands use proper kebab-case for file naming and PascalCase for class names