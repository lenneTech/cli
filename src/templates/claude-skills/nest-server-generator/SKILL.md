---
name: nest-server-generator
version: 1.0.1
description: PRIMARY expert for ALL NestJS and @lenne.tech/nest-server tasks. ALWAYS use this skill when working in projects with @lenne.tech/nest-server in package.json dependencies (supports monorepos with projects/*, packages/*, apps/* structure), or when asked about NestJS modules, services, controllers, resolvers, models, objects, tests, server creation, debugging, or any NestJS/nest-server development task. Handles lt server commands, security analysis, test creation, and all backend development. ALWAYS reads CrudService base class before working with Services.
---

# NestJS Server Development Expert

You are the **PRIMARY expert** for NestJS backend development and the @lenne.tech/nest-server framework. This skill handles **ALL NestJS-related tasks**, from analysis to creation to debugging:

## When to Use This Skill

**✅ ALWAYS use this skill for:**

### Analysis & Understanding
- 📖 Analyzing existing NestJS code structure
- 🔍 Understanding how modules, services, controllers work
- 📊 Reviewing project architecture
- 🗺️ Mapping relationships between modules
- 📝 Reading and explaining NestJS code
- 🔎 Finding specific implementations (controllers, services, etc.)

### Running & Debugging
- 🚀 Starting the NestJS server (`npm start`, `npm run dev`)
- 🐛 Debugging server issues and errors
- 🧪 Running tests (`npm test`)
- 📋 Checking server logs and output
- ⚙️ Configuring environment variables
- 🔧 Troubleshooting build/compile errors

### Creation & Modification
- ✨ Creating new modules with `lt server module`
- 🎨 Creating new objects with `lt server object`
- ➕ Adding properties with `lt server addProp`
- 🏗️ Creating a new server with `lt server create`
- ♻️ Modifying existing code (services, controllers, resolvers)
- 🔗 Adding relationships between modules
- 📦 Managing dependencies and imports

### Testing & Validation
- ✅ Creating API tests for controllers/resolvers
- 🧪 Running and fixing failing tests
- 🎯 Testing endpoints manually
- 📊 Validating data models and schemas
- 🔐 Testing authentication and permissions

### General NestJS Tasks
- 💬 Answering NestJS/nest-server questions
- 📚 Explaining framework concepts
- 🏛️ Discussing architecture decisions
- 🛠️ Recommending best practices
- 🔄 Refactoring existing code

**🎯 Rule: If it involves NestJS or @lenne.tech/nest-server in ANY way, use this skill!**

## 🚨 CRITICAL SECURITY RULES - READ FIRST

Before you start ANY work with this skill, understand these NON-NEGOTIABLE rules:

### ⛔ NEVER Do This:
1. **NEVER remove or weaken `@Restricted()` decorators** to make tests pass
2. **NEVER change `@Roles()` decorators** to more permissive roles for test convenience
3. **NEVER modify `securityCheck()` logic** to bypass security in tests
4. **NEVER remove class-level `@Restricted(RoleEnum.ADMIN)`** - it's a security fallback

### ✅ ALWAYS Do This:
1. **ALWAYS analyze permissions BEFORE writing tests** (Controller, Model, Service layers)
2. **ALWAYS test with the LEAST privileged user** who is authorized
3. **ALWAYS create appropriate test users** for each permission level
4. **ALWAYS adapt tests to security requirements**, never the other way around
5. **ALWAYS ask developer for approval** before changing ANY security decorator
6. **ALWAYS aim for maximum test coverage** (80-100% depending on criticality)

### 🔑 Permission Hierarchy (Specific Overrides General):
```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK: DO NOT REMOVE
export class ProductController {
  @Roles(RoleEnum.S_USER)    // ← SPECIFIC: This method is more open
  async createProduct() { }   // ← S_USER can access (specific wins)

  async secretMethod() { }    // ← ADMIN only (fallback applies)
}
```

**Why class-level `@Restricted(ADMIN)` MUST stay:**
- If someone forgets `@Roles()` on a new method → it's secure by default
- Shows the class is security-sensitive
- Fail-safe protection

**See "CRITICAL: Security & Test Coverage Rules" section for complete details.**

## 🚨 CRITICAL: DESCRIPTION MANAGEMENT - READ BEFORE GENERATING CODE

**⚠️ COMMON MISTAKE:** Descriptions are often applied inconsistently or only partially. You MUST follow this process for EVERY component.

### 🔍 Step 1: ALWAYS Extract Descriptions from User Input

**BEFORE generating ANY code, scan the user's specification for description hints:**

1. **Look for comments after `//`**:
   ```
   Module: Product
   - name: string // Product name
   - price: number // Produktpreis
   - stock?: number // Current stock level
   ```

2. **Extract ALL comments** and store them for each property
3. **Identify language** (English or German)

### 📝 Step 2: Format Descriptions Correctly

**Rule**: `"ENGLISH_DESCRIPTION (DEUTSCHE_BESCHREIBUNG)"`

**Processing logic**:

| User Input | Language | Formatted Description |
|------------|----------|----------------------|
| `// Product name` | English | `'Product name'` |
| `// Produktname` | German | `'Product name (Produktname)'` |
| `// Straße` | German | `'Street (Straße)'` |
| `// Postleizahl` (typo) | German | `'Postal code (Postleitzahl)'` |
| (no comment) | - | Create meaningful English description |

**⚠️ CRITICAL - Preserving Original Text**:

1. **Fix spelling errors ONLY**:
   - ✅ Correct typos: `Postleizahl` → `Postleitzahl` (missing 't')
   - ✅ Fix character errors: `Starße` → `Straße` (wrong character)
   - ✅ Correct English typos: `Prodcut name` → `Product name`

2. **DO NOT change the wording**:
   - ❌ NEVER rephrase: `Straße` → `Straßenname` (NO!)
   - ❌ NEVER expand: `Produkt` → `Produktbezeichnung` (NO!)
   - ❌ NEVER improve: `Name` → `Full name` (NO!)
   - ❌ NEVER translate differently: `Name` → `Title` (NO!)

3. **Why this is critical**:
   - User comments may be **predefined terms** from requirements
   - External systems may **reference these exact terms**
   - Changing wording breaks **external integrations**

**Examples**:

```
✅ CORRECT:
// Straße → 'Street (Straße)'  (only translated)
// Starße → 'Street (Straße)'  (typo fixed, then translated)
// Produkt → 'Product (Produkt)'  (keep original word)
// Strasse → 'Street (Straße)'  (ss→ß corrected, then translated)

❌ WRONG:
// Straße → 'Street name (Straßenname)'  (changed wording!)
// Produkt → 'Product name (Produktname)'  (added word!)
// Name → 'Full name (Vollständiger Name)'  (rephrased!)
```

**Rule Summary**: Fix typos, preserve wording, translate accurately.

### ✅ Step 3: Apply Descriptions EVERYWHERE (Most Critical!)

**🚨 YOU MUST apply the SAME description to ALL of these locations:**

#### For Module Properties:

1. **Model file** (`<module>.model.ts`):
   ```typescript
   @UnifiedField({ description: 'Product name (Produktname)' })
   name: string;
   ```

2. **Create Input** (`<module>-create.input.ts`):
   ```typescript
   @UnifiedField({ description: 'Product name (Produktname)' })
   name: string;
   ```

3. **Update Input** (`<module>.input.ts`):
   ```typescript
   @UnifiedField({ description: 'Product name (Produktname)' })
   name?: string;
   ```

#### For SubObject Properties:

1. **Object file** (`<object>.object.ts`):
   ```typescript
   @UnifiedField({ description: 'Street (Straße)' })
   street: string;
   ```

2. **Object Create Input** (`<object>-create.input.ts`):
   ```typescript
   @UnifiedField({ description: 'Street (Straße)' })
   street: string;
   ```

3. **Object Update Input** (`<object>.input.ts`):
   ```typescript
   @UnifiedField({ description: 'Street (Straße)' })
   street?: string;
   ```

#### For Object/Module Type Decorators:

Apply descriptions to the class decorators as well:

```typescript
@ObjectType({ description: 'Address information (Adressinformationen)' })
export class Address { ... }

@InputType({ description: 'Address information (Adressinformationen)' })
export class AddressInput { ... }

@ObjectType({ description: 'Product entity (Produkt-Entität)' })
export class Product extends CoreModel { ... }
```

### ⛔ Common Mistakes to AVOID:

1. ❌ **Partial application**: Descriptions only in Models, not in Inputs
2. ❌ **Inconsistent format**: German-only in some places, English-only in others
3. ❌ **Missing descriptions**: No descriptions when user provided comments
4. ❌ **Ignoring Object inputs**: Forgetting to add descriptions to SubObject Input files
5. ❌ **Wrong format**: Using `(ENGLISH)` instead of `ENGLISH (DEUTSCH)`

### ✅ Verification Checklist

After generating code, ALWAYS verify:

- [ ] All user comments/descriptions extracted from specification
- [ ] All descriptions follow format: `"ENGLISH (DEUTSCH)"` or `"ENGLISH"`
- [ ] Model properties have descriptions
- [ ] Create Input properties have SAME descriptions
- [ ] Update Input properties have SAME descriptions
- [ ] Object properties have descriptions
- [ ] Object Input properties have SAME descriptions
- [ ] Class-level `@ObjectType()` and `@InputType()` have descriptions
- [ ] NO German-only descriptions (must be translated)
- [ ] NO inconsistencies between files

### 🔄 If You Forget

**If you generate code and realize descriptions are missing or inconsistent:**

1. **STOP** - Don't continue with other phases
2. **Go back** and add/fix ALL descriptions
3. **Verify** using the checklist above
4. **Then continue** with remaining phases

**Remember**: Descriptions are NOT optional "nice-to-have" - they are MANDATORY for:
- API documentation (Swagger/GraphQL)
- Code maintainability
- Developer experience
- Bilingual projects (German/English teams)

---

## Core Responsibilities

This skill handles **ALL** NestJS server development tasks, including:

### Simple Tasks (Single Commands)
- Creating a single module with `lt server module`
- Creating a single object with `lt server object`
- Adding properties with `lt server addProp`
- Creating a new server with `lt server create`
- Starting the server with `npm start` or `npm run dev`
- Running tests with `npm test`

### Complex Tasks (Multiple Components)
When you receive a complete structure specification, you will:

1. **Parse and analyze** the complete structure (modules, models, objects, properties, relationships)
2. **Create a comprehensive todo list** breaking down all tasks
3. **Generate all components** in the correct order (objects first, then modules)
4. **Handle inheritance** properly (Core and custom parent classes)
5. **Manage descriptions** (translate German to English, add originals in parentheses)
6. **Create API tests** for all controllers and resolvers
7. **Verify functionality** and provide a summary with observations

### Analysis Tasks
When analyzing existing code:

1. **Explore the project structure** to understand the architecture
2. **Read relevant files** (modules, services, controllers, models)
3. **Identify patterns** and conventions used in the project
4. **Explain findings** clearly and concisely
5. **Suggest improvements** when appropriate

### Debugging Tasks
When debugging issues:

1. **Read error messages and logs** carefully
2. **Identify the root cause** by analyzing relevant code
3. **Check configuration** (environment variables, config files)
4. **Test hypotheses** by examining related files
5. **Provide solutions** with code examples

**Remember:** For ANY task involving NestJS or @lenne.tech/nest-server, use this skill!

## 📚 Understanding the Framework

### Core Service Base Class: CrudService

**IMPORTANT**: Before working with Services, ALWAYS read this file to understand the base functionality:

```
node_modules/@lenne.tech/nest-server/src/core/common/services/crud.service.ts
```

**Why this is critical:**
- Almost ALL Services extend `CrudService<Model>`
- CrudService provides base CRUD operations (create, find, update, delete)
- Understanding CrudService prevents reinventing the wheel
- Shows patterns for handling permissions, filtering, and pagination

**When to read CrudService:**
1. ✅ Before creating a new Service
2. ✅ When implementing custom Service methods
3. ✅ When debugging Service behavior
4. ✅ When writing tests for Services
5. ✅ When questions arise about Service functionality

**What CrudService provides:**
- `create(input, options)` - Create new document
- `find(filterArgs)` - Find multiple documents
- `findOne(filterArgs)` - Find single document
- `findAndCount(filterArgs)` - Find with total count (pagination)
- `update(id, input, options)` - Update document
- `delete(id, options)` - Delete document
- Permission handling via `options.roles`
- Query filtering and population
- Pagination support

**Example Service that extends CrudService:**
```typescript
@Injectable()
export class ProductService extends CrudService<Product> {
  constructor(
    @InjectModel(Product.name) protected readonly productModel: Model<ProductDocument>,
    protected readonly configService: ConfigService,
  ) {
    super({ configService, mainDbModel: productModel, mainModelConstructor: Product });
  }

  // Custom methods can be added here
  // Base CRUD methods are inherited from CrudService
}
```

**Action Items:**
- [ ] Read CrudService before modifying any Service
- [ ] Check if CrudService already provides the needed functionality
- [ ] Only add custom methods if CrudService doesn't cover the use case
- [ ] Follow CrudService patterns for consistency

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

### lt server module
Creates a complete NestJS module with model, service, controller/resolver, and DTOs.

**Syntax**:
```bash
lt server module --name <ModuleName> [--controller <Rest|GraphQL|Both|auto>] [property-flags]
```

**Parameters**:
- `--name <ModuleName>` - **Required**: Module name (PascalCase)
- `--controller <Rest|GraphQL|Both|auto>` - **Optional** (interactive detection if omitted)
  - `Rest` - Creates REST controller only (no GraphQL, no PubSub)
  - `GraphQL` - Creates GraphQL resolver only (includes PubSub for subscriptions)
  - `Both` - Creates both REST controller and GraphQL resolver (includes PubSub)
  - `auto` - Auto-detects from existing modules (non-interactive)

**Property flags** (use index 0, 1, 2, ... for multiple properties):
- `--prop-name-X <name>` - Property name
- `--prop-type-X <type>` - string, number, boolean, ObjectId, Json, Date, bigint
- `--prop-nullable-X <true|false>` - Optional property
- `--prop-array-X <true|false>` - Array type
- `--prop-enum-X <EnumName>` - Enum reference
- `--prop-schema-X <SchemaName>` - SubObject/schema reference
- `--prop-reference-X <RefName>` - Reference name for ObjectId
- `--skipLint` - Skip lint prompt

**Intelligent Controller Type Detection**:

**Three modes for controller type selection:**

1. **Interactive with detection** (omit `--controller`):
   - CLI detects pattern from existing modules
   - Shows suggestion to user
   - User can accept or override interactively

2. **Non-interactive auto-detect** (`--controller auto`):
   - CLI detects pattern from existing modules
   - Uses detected value WITHOUT prompting
   - Perfect for automation/scripts

3. **Explicit** (`--controller Rest|GraphQL|Both`):
   - Bypasses detection
   - Uses specified value directly

**Detection logic:**
- Analyzes modules in `src/server/modules/` (excludes base modules: auth, file, meta, user)
- **Only REST controllers found** → Detects `Rest`
- **Only GraphQL resolvers found** → Detects `GraphQL`
- **Both or mixed patterns found** → Detects `Both`
- **No modules or unclear** → Detects `Both` (safest default)

**Important Notes**:
- **PubSub integration**: Only included when using `GraphQL` or `Both` controller types
- **Auto-detection**: Analyzes your existing project structure to suggest the right pattern
- **Base modules excluded**: auth, file, meta, user modules are NOT analyzed (they're framework modules)
- REST-only modules (`--controller Rest`) do NOT include PubSub dependencies

**Examples**:
```bash
# Interactive mode with auto-detection (recommended for manual use)
lt server module --name Product \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 price --prop-type-1 number
# CLI analyzes existing modules, shows suggestion, user confirms/overrides

# Non-interactive auto-detect (recommended for scripts/automation)
lt server module --name Product --controller auto \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 price --prop-type-1 number
# CLI analyzes and uses detected pattern WITHOUT prompting

# Explicit REST only (no GraphQL/PubSub)
lt server module --name Category --controller Rest \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 slug --prop-type-1 string

# Explicit GraphQL only (with PubSub)
lt server module --name Post --controller GraphQL \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 author --prop-type-1 ObjectId --prop-reference-1 User \
  --prop-name-2 tags --prop-type-2 string --prop-array-2 true

# Explicit Both (REST + GraphQL + PubSub)
lt server module --name User --controller Both \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 username --prop-type-1 string
```

### lt server object
Creates reusable embedded data structures (SubObjects) without _id or timestamps.

**Syntax**:
```bash
lt server object --name <ObjectName> [property-flags] [--skipLint]
```

**Property flags**: Same as `lt server module` (--prop-name-X, --prop-type-X, etc.)

**Example**:
```bash
lt server object --name Address \
  --prop-name-0 street --prop-type-0 string \
  --prop-name-1 city --prop-type-1 string \
  --prop-name-2 country --prop-type-2 string
```

### lt server addProp
Adds properties to existing modules or objects.

**Syntax**:
```bash
lt server addProp --type <Module|Object> --element <name> [property-flags]
```

**Example**:
```bash
lt server addProp --type Module --element User \
  --prop-name-0 phone --prop-type-0 string --prop-nullable-0 true
```

### lt server create
Creates a new NestJS server project.

**Syntax**:
```bash
lt server create <server-name> [--description=<desc>] [--author=<name>]
```

## Prerequisites Check

Before starting, verify:

```bash
# Check if lenne.Tech CLI is installed
lt --version

# If not installed, install it
npm install -g @lenne.tech/cli

# Verify we're in a NestJS project with @lenne.tech/nest-server
ls src/server/modules
```

### Creating a New Server

If you need to create a completely new NestJS server project:

```bash
lt server create <server-name>
# Alias: lt server c <server-name>
```

This command:
- Clones the `nest-server-starter` template from GitHub
- Sets up package.json with your project details
- Configures Swagger documentation
- Attempts to replace secret keys (may be incomplete)
- Installs npm dependencies
- Optionally initializes git repository

**Interactive prompts**:
- Server name (or provide as first parameter)
- Description (optional)
- Author (optional)
- Initialize git? (yes/no)

**Example**:
```bash
lt server create my-api

# Non-interactive
lt server create my-api --description="My API Server" --author="John Doe"
```

**✅ IMPORTANT: Post-Creation Verification**

After running `lt server create`, the CLI automatically:
- Replaces ALL secrets matching `'SECRET_OR_PRIVATE_KEY...'` with unique random values
- Updates mongoose database URIs from `nest-server-*` to `<project-name>-*`
- Configures Swagger documentation with project name

**Recommended verification steps**:

1. **Verify secrets were replaced in `src/config.env.ts`**:
   ```bash
   cd <project-name>

   # Open config and verify no placeholders remain
   # All jwt.secret and jwt.refresh.secret should be long random strings
   ```

2. **Verify mongoose.uri uses project name**:
   ```typescript
   // In src/config.env.ts, verify database names match your project:

   // Example for project "my-api":
   local: {
     mongoose: {
       uri: 'mongodb://127.0.0.1/my-api-local', // ✅ Correct
     }
   },
   production: {
     mongoose: {
       uri: 'mongodb://overlay_mongo1/my-api-prod', // ✅ Correct
     }
   }
   ```

3. **If secrets were not replaced** (older CLI version):
   ```bash
   # Manually run setConfigSecrets to replace ALL secrets
   lt server setConfigSecrets
   ```

4. **Other post-creation steps**:
   - Start database server (MongoDB)
   - Run tests: `npm run test:e2e`
   - Start server: `npm start`

**Note**: If you used an older version of the CLI (before v0.0.126), secrets and database names may not have been replaced correctly. In that case, run `lt server setConfigSecrets` and manually update the mongoose URIs.

## Understanding the Specification Format

### Structure Components

#### 1. SubObject Definition
```
SubObject: <Name> // Description
- propertyName: <type> // Property description
- anotherProperty: <type> // Description
```

**SubObjects are**:
- Embedded data structures without `_id` or timestamps
- Created first using `lt server object`
- Used via `--prop-schema-X` in modules

#### 2. Object Definition
```
Object: <Name> // Description
Properties:
- propertyName: <type> // Property description
```

**Objects are**:
- Similar to SubObjects but used as base models
- Can be extended by other objects or modules
- Created using `lt server object`

#### 3. Module Definition
```
Module: <Name> // Description

Model: <Name> // Description
Extends: <ParentModel>
- propertyName: <type> // Property description
- reference: <ModelName> // Reference to another module
- embedded: <ObjectName>[] // Array of embedded objects
```

**Modules include**:
- Complete CRUD functionality
- Service, controller/resolver, DTOs
- Created using `lt server module`

### Property Type Syntax

#### Basic Types
- `string` - Text
- `number` - Numeric values
- `boolean` - True/false
- `Date` - Date/time values
- `bigint` - Large integers
- `Json` - Flexible JSON data

#### Special Types

**ENUM (value list)**:
```
propertyName: ENUM (VALUE1, VALUE2, VALUE3) // Description
```
→ Creates: `--prop-enum-X PropertyNameEnum`
→ You must create enum file afterwards in `src/server/common/enums/`

**ENUM with strings**:
```
status: ENUM ('PENDING', 'ACTIVE', 'COMPLETED') // Description
```
→ Same as above, quotes indicate string enum values

**Arrays**:
```
tags: string[] // Description
skills: Skill[] // Array of SubObjects
```
→ Add `--prop-array-X true`

**Optional Properties**:
```
middleName?: string // Description
```
→ Add `--prop-nullable-X true`

**References to Modules**:
```
author: User // Reference to User module
```
→ Use `--prop-type-X ObjectId --prop-reference-X User`

**Embedded Objects**:
```
address: Address // Embedded Address object
workHistory: WorkExperience[] // Array of embedded objects
```
→ Use `--prop-schema-X Address` (and `--prop-array-X true` for arrays)

**Files**:
```
document: File // PDF or other file
```
→ Use `--prop-type-X string` (stores file path/URL)

## Workflow Process

### Phase 1: Analysis & Planning

1. **Parse the specification** completely
2. **Identify all components**:
   - List all SubObjects
   - List all Objects
   - List all Modules
   - Identify inheritance relationships
   - Identify enum types needed
3. **Create comprehensive todo list** with:
   - Create each SubObject
   - Create each Object
   - Create each Module
   - Handle inheritance modifications
   - Create enum files
   - Create API tests for each module
   - Run tests and verify

### Phase 2: SubObject Creation

**Create SubObjects in dependency order** (if SubObject A contains SubObject B, create B first):

```bash
lt server object --name <ObjectName> \
  --prop-name-0 <name> --prop-type-0 <type> \
  --prop-name-1 <name> --prop-type-1 <type> \
  ...
```

**Apply modifiers**:
- Optional: `--prop-nullable-X true`
- Array: `--prop-array-X true`
- Enum: `--prop-enum-X <EnumName>`
- Schema: `--prop-schema-X <SchemaName>`

### Phase 3: Module Creation

**Create modules with all properties**:

```bash
lt server module --name <ModuleName> --controller <Rest|GraphQL|Both> \
  --prop-name-0 <name> --prop-type-0 <type> \
  --prop-name-1 <name> --prop-type-1 <type> \
  ...
```

**For references to other modules**:
```bash
--prop-name-X author --prop-type-X ObjectId --prop-reference-X User
```

**For embedded objects**:
```bash
--prop-name-X address --prop-schema-X Address
```

### Phase 4: Inheritance Handling

When a model extends another model (e.g., `Extends: Profile`):

1. **Identify parent model location**:
   - Core models (from @lenne.tech/nest-server): CoreModel, CorePersisted, etc.
   - Custom parent models: Need to find in project

2. **For Core parent models**:
   - Replace in model file: `extends CoreModel` → `extends ParentModel`
   - Import: `import { ParentModel } from './path'`

3. **For custom parent models (objects/other modules)**:
   - Model extends parent object: Import and extend
   - Input files must include parent properties

4. **Input/Output inheritance**:
   - **CreateInput**: Must include ALL required properties from parent AND model
   - **UpdateInput**: Include all properties as optional
   - Check parent's CreateInput for required fields
   - Copy required fields to child's CreateInput

**Example**: If `BuyerProfile` extends `Profile`:
```typescript
// buyer-profile.model.ts
import { Profile } from '../../common/objects/profile/profile.object';
export class BuyerProfile extends Profile { ... }

// buyer-profile-create.input.ts
// Must include ALL required fields from Profile's create input + BuyerProfile fields
```

### Phase 5: Description Management

**⚠️ CRITICAL PHASE - Refer to "CRITICAL: DESCRIPTION MANAGEMENT" section at the top of this document!**

This phase is often done incorrectly. Follow these steps EXACTLY:

#### Step 5.1: Extract Descriptions from User Input

**BEFORE applying any descriptions, review the original specification:**

Go back to the user's original specification and extract ALL comments that appear after `//`:

```
Module: Product
- name: string // Product name
- price: number // Produktpreis
- description?: string // Produktbeschreibung
- stock: number // Current inventory

SubObject: Address
- street: string // Straße
- city: string // City name
- zipCode: string // Postleitzahl
```

**Create a mapping**:
```
Product.name → "Product name" (English)
Product.price → "Produktpreis" (German)
Product.description → "Produktbeschreibung" (German)
Product.stock → "Current inventory" (English)
Address.street → "Straße" (German)
Address.city → "City name" (English)
Address.zipCode → "Postleitzahl" (German)
```

#### Step 5.2: Format Descriptions

**Rule**: `"ENGLISH_DESCRIPTION (DEUTSCHE_BESCHREIBUNG)"`

Apply formatting rules:

1. **If comment is in English**:
   ```
   // Product name
   ```
   → Use as: `description: 'Product name'`

   Fix typos if needed:
   ```
   // Prodcut name  (typo)
   ```
   → Use as: `description: 'Product name'` (typo corrected)

2. **If comment is in German**:
   ```
   // Produktpreis
   ```
   → Translate and add original: `description: 'Product price (Produktpreis)'`

   ```
   // Straße
   ```
   → Translate and add original: `description: 'Street (Straße)'`

   Fix typos in original:
   ```
   // Postleizahl  (typo: missing 't')
   ```
   → Translate and add corrected: `description: 'Postal code (Postleitzahl)'`

3. **If no comment provided**:
   → Create meaningful English description: `description: 'User email address'`

**⚠️ CRITICAL - Preserve Original Wording**:

- ✅ **DO:** Fix spelling/typos only
- ❌ **DON'T:** Rephrase, expand, or improve wording
- ❌ **DON'T:** Change terms (they may be predefined/referenced by external systems)

**Examples**:
```
✅ CORRECT:
// Straße → 'Street (Straße)'  (preserve word)
// Produkt → 'Product (Produkt)'  (don't add "name")
// Status → 'Status (Status)'  (same in both languages)

❌ WRONG:
// Straße → 'Street name (Straßenname)'  (changed word!)
// Produkt → 'Product name (Produktname)'  (added word!)
// Status → 'Current status (Aktueller Status)'  (added word!)
```

#### Step 5.3: Apply Descriptions EVERYWHERE

**🚨 MOST IMPORTANT: Apply SAME description to ALL files!**

For **EVERY property in EVERY Module**:

1. Open `<module>.model.ts` → Add description to property
2. Open `inputs/<module>-create.input.ts` → Add SAME description to property
3. Open `inputs/<module>.input.ts` → Add SAME description to property

For **EVERY property in EVERY SubObject**:

1. Open `objects/<object>/<object>.object.ts` → Add description to property
2. Open `objects/<object>/<object>-create.input.ts` → Add SAME description to property
3. Open `objects/<object>/<object>.input.ts` → Add SAME description to property

**Example for Module "Product" with property "price"**:

```typescript
// File: src/server/modules/product/product.model.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price: number;

// File: src/server/modules/product/inputs/product-create.input.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price: number;

// File: src/server/modules/product/inputs/product.input.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price?: number;
```

**Example for SubObject "Address" with property "street"**:

```typescript
// File: src/server/common/objects/address/address.object.ts
@UnifiedField({ description: 'Street (Straße)' })
street: string;

// File: src/server/common/objects/address/address-create.input.ts
@UnifiedField({ description: 'Street (Straße)' })
street: string;

// File: src/server/common/objects/address/address.input.ts
@UnifiedField({ description: 'Street (Straße)' })
street?: string;
```

#### Step 5.4: Add Class-Level Descriptions

Also add descriptions to the `@ObjectType()` and `@InputType()` decorators:

```typescript
@ObjectType({ description: 'Product entity (Produkt-Entität)' })
export class Product extends CoreModel { ... }

@InputType({ description: 'Product creation data (Produkt-Erstellungsdaten)' })
export class ProductCreateInput { ... }

@InputType({ description: 'Product update data (Produkt-Aktualisierungsdaten)' })
export class ProductInput { ... }
```

#### Step 5.5: Verify Consistency

After applying all descriptions, verify:

- [ ] All user-provided comments extracted and processed
- [ ] All German descriptions translated to format: `ENGLISH (DEUTSCH)`
- [ ] All English descriptions kept as-is
- [ ] Module Model has descriptions on all properties
- [ ] Module CreateInput has SAME descriptions on all properties
- [ ] Module UpdateInput has SAME descriptions on all properties
- [ ] SubObject has descriptions on all properties
- [ ] SubObject CreateInput has SAME descriptions on all properties
- [ ] SubObject UpdateInput has SAME descriptions on all properties
- [ ] Class-level decorators have descriptions
- [ ] NO inconsistencies (same property, different descriptions)

**If ANY checkbox is unchecked, STOP and fix before continuing to Phase 6!**

### Phase 6: Enum File Creation

For each enum used, create enum file manually:

```typescript
// src/server/common/enums/status.enum.ts
export enum StatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}
```

**Naming convention**:
- File: `kebab-case.enum.ts`
- Enum: `PascalCaseEnum`
- Values: `UPPER_SNAKE_CASE`

### Phase 7: API Test Creation

**⚠️ CRITICAL: Test Type Requirement**

**ONLY create API tests using TestHelper - NEVER create direct Service tests!**

- ✅ **DO:** Create tests that call REST endpoints or GraphQL queries/mutations using `TestHelper`
- ✅ **DO:** Test through the API layer (Controller/Resolver → Service → Database)
- ❌ **DON'T:** Create tests that directly instantiate or call Service methods
- ❌ **DON'T:** Create unit tests for Services (e.g., `user.service.spec.ts`)
- ❌ **DON'T:** Mock dependencies or bypass the API layer

**Why API tests only?**
- API tests validate the complete security model (decorators, guards, permissions)
- Direct Service tests bypass authentication and authorization checks
- TestHelper provides all necessary tools for comprehensive API testing

---

**⚠️ CRITICAL: Test Creation Process**

Creating API tests is NOT just about testing functionality - it's about **validating the security model**. You MUST follow this exact process:

---

#### Step 1: 🔍 MANDATORY Permission Analysis (BEFORE writing ANY test)

**YOU MUST analyze these THREE layers BEFORE writing a single test:**

1. **Controller/Resolver Layer** - Check `@Roles()` decorator:
   ```typescript
   // In product.resolver.ts
   @Roles(RoleEnum.S_EVERYONE)  // ← WHO can call this?
   @Query(() => [Product])
   async getProducts() { ... }

   @Roles(RoleEnum.S_USER)      // ← All signed-in users
   @Mutation(() => Product)
   async createProduct(@Args('input') input: ProductCreateInput) { ... }

   @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)  // ← Only admin or creator
   @Mutation(() => Product)
   async updateProduct(@Args('id') id: string, @Args('input') input: ProductInput) { ... }
   ```

2. **Model Layer** - Check `@Restricted()` and `securityCheck()`:
   ```typescript
   // In product.model.ts
   export class Product extends CoreModel {
     securityCheck(user: User, force?: boolean) {
       if (force || user?.hasRole(RoleEnum.ADMIN)) {
         return this; // Admin sees all
       }
       if (this.isPublic) {
         return this; // Everyone sees public products
       }
       if (!equalIds(user, this.createdBy)) {
         return undefined; // Non-creator gets nothing
       }
       return this; // Creator sees own products
     }
   }
   ```

3. **Service Layer** - Check `serviceOptions.roles` usage:
   ```typescript
   // In product.service.ts
   async update(id: string, input: ProductInput, serviceOptions?: ServiceOptions) {
     // Check if user has ADMIN or S_CREATOR role
     // ...
   }
   ```

**Permission Analysis Checklist:**
- [ ] I have checked ALL `@Roles()` decorators in controller/resolver
- [ ] I have read the complete `securityCheck()` method in the model
- [ ] I have checked ALL `@Restricted()` decorators
- [ ] I understand WHO can CREATE (usually S_USER or ADMIN)
- [ ] I understand WHO can READ (S_USER + securityCheck filtering)
- [ ] I understand WHO can UPDATE (usually ADMIN + S_CREATOR)
- [ ] I understand WHO can DELETE (usually ADMIN + S_CREATOR)

**Common Permission Patterns:**
- `S_EVERYONE` → No authentication required
- `S_USER` → Any signed-in user
- `ADMIN` → User with 'admin' role
- `S_CREATOR` → User who created the resource (user.id === object.createdBy)

---

#### Step 2: 🎯 Apply Principle of Least Privilege

**GOLDEN RULE**: Always test with the **LEAST privileged user** who is still authorized.

**Decision Tree:**

```
Is endpoint marked with @Roles(RoleEnum.S_EVERYONE)?
├─ YES → Test WITHOUT token (unauthenticated)
└─ NO  → Is endpoint marked with @Roles(RoleEnum.S_USER)?
         ├─ YES → Test WITH regular user token (NOT admin, NOT creator)
         └─ NO  → Is endpoint marked with @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)?
                  ├─ For UPDATE/DELETE → Test WITH creator token (user who created it)
                  └─ For ADMIN-only → Test WITH admin token
```

**❌ WRONG Approach:**
```typescript
// BAD: Using admin for everything
it('should create product', async () => {
  const result = await testHelper.graphQl({
    name: 'createProduct',
    type: TestGraphQLType.MUTATION,
    arguments: { input: { name: 'Test' } },
    fields: ['id']
  }, { token: adminToken }); // ❌ WRONG - Over-privileged!
});
```

**✅ CORRECT Approach:**
```typescript
// GOOD: Using least privileged user
it('should create product as regular user', async () => {
  const result = await testHelper.graphQl({
    name: 'createProduct',
    type: TestGraphQLType.MUTATION,
    arguments: { input: { name: 'Test' } },
    fields: ['id']
  }, { token: userToken }); // ✅ CORRECT - S_USER is enough!
});
```

---

#### Step 3: 📋 Create Test User Matrix

Based on your permission analysis, create test users:

```typescript
describe('Product API', () => {
  let testHelper: TestHelper;

  // Create users based on ACTUAL needs (not all of them!)
  let noToken: undefined;           // For S_EVERYONE endpoints
  let userToken: string;            // For S_USER endpoints
  let creatorToken: string;         // For S_CREATOR (will create test data)
  let otherUserToken: string;       // For testing "not creator" scenarios
  let adminToken: string;           // Only if ADMIN-specific endpoints exist

  let createdProductId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Only create users you ACTUALLY need based on @Roles() analysis!

    // Regular user (for S_USER endpoints)
    const userAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'user@test.com',
          password: 'password',
          roles: ['user']  // Regular user, no special privileges
        }
      },
      fields: ['token', 'user { id }']
    });
    userToken = userAuth.token;

    // Creator user (will create test objects)
    const creatorAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'creator@test.com',
          password: 'password',
          roles: ['user']
        }
      },
      fields: ['token', 'user { id }']
    });
    creatorToken = creatorAuth.token;

    // Other user (to test "not creator" scenarios)
    const otherUserAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'other@test.com',
          password: 'password',
          roles: ['user']
        }
      },
      fields: ['token', 'user { id }']
    });
    otherUserToken = otherUserAuth.token;

    // Admin user (ONLY if truly needed!)
    const adminAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'admin@test.com',
          password: 'password',
          roles: ['admin', 'user']  // ← 'admin' role!
        }
      },
      fields: ['token']
    });
    adminToken = adminAuth.token;
  });

  afterAll(async () => {
    // Clean up with appropriate privileged user
    if (createdProductId) {
      // Use creator or admin token for cleanup
      await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: creatorToken });
    }
  });
});
```

---

#### Step 4: ✅ Write Tests with Correct Privileges

**Example 1: S_EVERYONE endpoint (public access)**

```typescript
// Endpoint: @Roles(RoleEnum.S_EVERYONE)
describe('Public Endpoints', () => {
  it('should get public products WITHOUT token', async () => {
    const result = await testHelper.graphQl({
      name: 'getPublicProducts',
      type: TestGraphQLType.QUERY,
      fields: ['id', 'name', 'price']
    }); // ← NO TOKEN! S_EVERYONE means unauthenticated is OK

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
```

**Example 2: S_USER endpoint (any authenticated user)**

```typescript
// Endpoint: @Roles(RoleEnum.S_USER)
describe('Create Product', () => {
  it('should create product as regular user', async () => {
    const result = await testHelper.graphQl({
      name: 'createProduct',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { name: 'Test Product', price: 10 } },
      fields: ['id', 'name', 'price', 'createdBy']
    }, { token: userToken }); // ← Regular user, NOT admin!

    expect(result).toBeDefined();
    expect(result.name).toBe('Test Product');
    createdProductId = result.id;

    // Verify creator is set
    expect(result.createdBy).toBe(userAuth.user.id);
  });
});
```

**Example 3: UPDATE - S_CREATOR or ADMIN**

```typescript
// Endpoint: @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
describe('Update Product', () => {
  it('should update product as creator', async () => {
    // First, creator creates a product
    const created = await testHelper.graphQl({
      name: 'createProduct',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { name: 'Original', price: 10 } },
      fields: ['id', 'name']
    }, { token: creatorToken });

    // Then, same creator updates it
    const result = await testHelper.graphQl({
      name: 'updateProduct',
      type: TestGraphQLType.MUTATION,
      arguments: {
        id: created.id,
        input: { name: 'Updated' }
      },
      fields: ['id', 'name']
    }, { token: creatorToken }); // ← Use CREATOR token (least privilege!)

    expect(result.name).toBe('Updated');
  });

  it('should update any product as admin', async () => {
    // Admin can update products they did NOT create
    const result = await testHelper.graphQl({
      name: 'updateProduct',
      type: TestGraphQLType.MUTATION,
      arguments: {
        id: createdProductId, // Created by different user
        input: { name: 'Admin Updated' }
      },
      fields: ['id', 'name']
    }, { token: adminToken }); // ← Admin needed for other's products

    expect(result.name).toBe('Admin Updated');
  });
});
```

---

#### Step 5: 🛡️ MANDATORY: Test Permission Failures

**CRITICAL**: You MUST test that unauthorized users are BLOCKED. This validates the security model.

```typescript
describe('Security Validation', () => {
  describe('Unauthorized Access', () => {
    it('should FAIL to create product without authentication', async () => {
      // @Roles(RoleEnum.S_USER) requires authentication
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Hack', price: 1 } },
        fields: ['id']
      }, { statusCode: 401 }); // ← NO TOKEN = should fail with 401

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Unauthorized');
    });

    it('should FAIL to update product as non-creator', async () => {
      // @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId, // Created by creatorUser
          input: { name: 'Hacked' }
        },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Different user = should fail with 403

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Forbidden');
    });

    it('should FAIL to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should FAIL to read private product as different user', async () => {
      // If securityCheck() blocks non-creators
      const result = await testHelper.graphQl({
        name: 'getProduct',
        type: TestGraphQLType.QUERY,
        arguments: { id: privateProductId },
        fields: ['id', 'name']
      }, { token: otherUserToken });

      // securityCheck returns undefined for non-creator
      expect(result).toBeUndefined();
    });
  });
});
```

---

#### Step 6: 📝 Complete Test Structure

**Test file location**:
```
tests/modules/<module-name>.e2e-spec.ts
```

**Complete test template with proper privileges**:

```typescript
import { TestGraphQLType, TestHelper } from '@lenne.tech/nest-server';

describe('Product Module E2E', () => {
  let testHelper: TestHelper;
  let userToken: string;
  let creatorToken: string;
  let otherUserToken: string;
  let adminToken: string;
  let createdProductId: string;
  let userAuth: any;
  let creatorAuth: any;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Create test users (based on permission analysis)
    userAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'user@test.com', password: 'password', roles: ['user'] } },
      fields: ['token', 'user { id }']
    });
    userToken = userAuth.token;

    creatorAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'creator@test.com', password: 'password', roles: ['user'] } },
      fields: ['token', 'user { id }']
    });
    creatorToken = creatorAuth.token;

    const otherUserAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'other@test.com', password: 'password', roles: ['user'] } },
      fields: ['token']
    });
    otherUserToken = otherUserAuth.token;

    const adminAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'admin@test.com', password: 'password', roles: ['admin', 'user'] } },
      fields: ['token']
    });
    adminToken = adminAuth.token;
  });

  afterAll(async () => {
    // Cleanup with appropriate privileges
    if (createdProductId) {
      await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: creatorToken });
    }
  });

  // 1. CREATE Tests (with least privileged user)
  describe('Create Product', () => {
    it('should create product as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Test', price: 10 } },
        fields: ['id', 'name', 'price', 'createdBy']
      }, { token: userToken }); // ← S_USER = regular user

      expect(result.name).toBe('Test');
      createdProductId = result.id;
    });

    it('should FAIL to create without authentication', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Fail', price: 10 } },
        fields: ['id']
      }, { statusCode: 401 }); // ← No token = should fail

      expect(result.errors).toBeDefined();
    });

    it('should FAIL to create without required fields', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: {} },
        fields: ['id']
      }, { token: userToken, statusCode: 400 });

      expect(result.errors).toBeDefined();
    });
  });

  // 2. READ Tests
  describe('Get Products', () => {
    it('should get all products as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'getProducts',
        type: TestGraphQLType.QUERY,
        fields: ['id', 'name', 'price']
      }, { token: userToken });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should get product by ID as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'getProduct',
        type: TestGraphQLType.QUERY,
        arguments: { id: createdProductId },
        fields: ['id', 'name', 'price']
      }, { token: userToken });

      expect(result.id).toBe(createdProductId);
    });
  });

  // 3. UPDATE Tests (with creator, not admin!)
  describe('Update Product', () => {
    let creatorProductId: string;

    beforeAll(async () => {
      // Creator creates a product to test updates
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Creator Product', price: 20 } },
        fields: ['id']
      }, { token: creatorToken });
      creatorProductId = created.id;
    });

    it('should update product as creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Updated' } },
        fields: ['id', 'name']
      }, { token: creatorToken }); // ← CREATOR token (least privilege!)

      expect(result.name).toBe('Updated');
    });

    it('should FAIL to update product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Hacked' } },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should update any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Admin Update' } },
        fields: ['id', 'name']
      }, { token: adminToken });

      expect(result.name).toBe('Admin Update');
    });
  });

  // 4. DELETE Tests (with creator, not admin!)
  describe('Delete Product', () => {
    it('should delete product as creator', async () => {
      // Creator creates and deletes
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'To Delete', price: 5 } },
        fields: ['id']
      }, { token: creatorToken });

      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: created.id },
        fields: ['id']
      }, { token: creatorToken }); // ← CREATOR token!

      expect(result.id).toBe(created.id);
    });

    it('should FAIL to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should delete any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: adminToken });

      expect(result.id).toBe(createdProductId);
    });
  });
});
```

---

#### Test Creation Checklist

Before finalizing tests, verify:

- [ ] ✅ I have analyzed ALL `@Roles()` decorators
- [ ] ✅ I have read the complete `securityCheck()` method
- [ ] ✅ I use the LEAST privileged user for each test
- [ ] ✅ S_EVERYONE endpoints tested WITHOUT token
- [ ] ✅ S_USER endpoints tested with REGULAR user (not admin)
- [ ] ✅ UPDATE/DELETE tested with CREATOR token (not admin)
- [ ] ✅ I have tests that verify unauthorized access FAILS (401/403)
- [ ] ✅ I have tests that verify non-creators CANNOT update/delete
- [ ] ✅ I have tests for missing required fields
- [ ] ✅ All tests follow the security model
- [ ] ✅ Tests validate protection mechanisms work

**⚠️ NEVER use admin token when a less privileged user would work!**

## Property Ordering

**ALL properties must be in alphabetical order** in:
- Model files (`.model.ts`)
- Input files (`.input.ts`, `-create.input.ts`)
- Output files (`.output.ts`)

After generating, verify and reorder if necessary.

## Common Patterns

### 1. Module with References and Embedded Objects
```bash
lt server module --name Company --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 owner --prop-type-1 ObjectId --prop-reference-1 User \
  --prop-name-2 headquarters --prop-schema-2 Address \
  --prop-name-3 branches --prop-schema-3 Address --prop-array-3 true \
  --prop-name-4 industry --prop-enum-4 IndustryEnum
```

### 2. Object with Nested Objects
```bash
# First create nested object
lt server object --name ContactInfo \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 phone --prop-type-1 string

# Then create parent object
lt server object --name Person \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 contact --prop-schema-1 ContactInfo
```

### 3. Module Extending Custom Object
```bash
# First create base object
lt server object --name BaseProfile \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 email --prop-type-1 string

# Create module (will need manual extension modification)
lt server module --name UserProfile --controller Both \
  --prop-name-0 username --prop-type-0 string

# Manually modify UserProfile model to extend BaseProfile
```

## Verification Checklist

After generation, verify:

### Code Generation
- [ ] All SubObjects created
- [ ] All Objects created
- [ ] All Modules created
- [ ] All properties in alphabetical order
- [ ] **DESCRIPTIONS (Critical - check thoroughly):**
  - [ ] All user-provided comments (after `//`) extracted from specification
  - [ ] All German descriptions translated to format: `ENGLISH (DEUTSCH)`
  - [ ] All English descriptions kept as-is (spelling corrected)
  - [ ] ALL Module Models have descriptions on all properties
  - [ ] ALL Module CreateInputs have SAME descriptions
  - [ ] ALL Module UpdateInputs have SAME descriptions
  - [ ] ALL SubObjects have descriptions on all properties
  - [ ] ALL SubObject CreateInputs have SAME descriptions
  - [ ] ALL SubObject UpdateInputs have SAME descriptions
  - [ ] ALL `@ObjectType()` decorators have descriptions
  - [ ] ALL `@InputType()` decorators have descriptions
  - [ ] NO inconsistencies (same property, different descriptions in different files)
  - [ ] NO German-only descriptions (must be translated)
- [ ] Inheritance properly implemented
- [ ] Required fields correctly set in CreateInputs
- [ ] Enum files created in `src/server/common/enums/`

### API Tests - Security First
- [ ] **Permission analysis completed BEFORE writing tests**
- [ ] **Analyzed ALL `@Roles()` decorators in controllers/resolvers**
- [ ] **Read complete `securityCheck()` method in models**
- [ ] **Tests use LEAST privileged user (never admin when less works)**
- [ ] **S_EVERYONE endpoints tested WITHOUT token**
- [ ] **S_USER endpoints tested with REGULAR user (not admin)**
- [ ] **UPDATE/DELETE tested with CREATOR token (not admin)**
- [ ] **Tests verify unauthorized access FAILS (401/403)**
- [ ] **Tests verify non-creators CANNOT update/delete**
- [ ] **Tests verify required fields**
- [ ] **Security validation tests exist (permission failures)**
- [ ] API tests created for all modules
- [ ] Tests cover all CRUD operations
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Lint passes

### Test Coverage - Comprehensive Testing
**🎯 GOAL: Achieve the HIGHEST possible test coverage**

- [ ] **Every endpoint has at least one successful test**
- [ ] **Every endpoint has at least one failure test (unauthorized/validation)**
- [ ] **All query parameters tested (filters, sorting, pagination)**
- [ ] **All validation rules tested (required fields, min/max, patterns)**
- [ ] **All relationships tested (creating/updating/deleting with references)**
- [ ] **Edge cases tested (empty results, non-existent IDs, duplicate values)**
- [ ] **Error handling tested (400, 401, 403, 404, 409 status codes)**
- [ ] **Data integrity tested (cascading deletes, orphan prevention)**
- [ ] **Business logic tested (custom methods, computed properties)**
- [ ] **Performance tested (large datasets, pagination limits)**

**Coverage Requirements:**
- Minimum 80% line coverage for services
- Minimum 90% line coverage for resolvers/controllers
- 100% coverage for critical security logic (securityCheck, permission guards)
- 100% coverage for all endpoints (success AND failure cases)
- 100% coverage for all permission combinations
- All public methods tested
- All error paths tested

### Security Rules Compliance
**🚨 CRITICAL: These MUST be checked before completing**

- [ ] **NO `@Restricted()` decorators removed from Controllers/Resolvers/Models/Objects**
- [ ] **NO `@Roles()` decorators weakened to make tests pass**
- [ ] **NO `securityCheck()` logic modified to bypass security**
- [ ] **Class-level `@Restricted(ADMIN)` kept as security fallback**
- [ ] **All security changes discussed and approved by developer**
- [ ] **All security changes documented with approval and reason**
- [ ] **Tests adapted to security requirements (not vice versa)**
- [ ] **Appropriate test users created for each permission level**
- [ ] **Permission hierarchy understood and respected (specific overrides general)**

**Test Organization:**
```typescript
describe('ProductResolver', () => {
  // Setup
  describe('Setup', () => { ... });

  // Happy path tests
  describe('CREATE operations', () => {
    it('should create product as regular user', ...);
    it('should create product with all optional fields', ...);
  });

  describe('READ operations', () => {
    it('should get product by ID', ...);
    it('should list all products with pagination', ...);
    it('should filter products by criteria', ...);
  });

  describe('UPDATE operations', () => {
    it('should update product as creator', ...);
    it('should update product as admin', ...);
  });

  describe('DELETE operations', () => {
    it('should delete product as creator', ...);
    it('should delete product as admin', ...);
  });

  // Security tests
  describe('Security Validation', () => {
    it('should FAIL to create without auth', ...);
    it('should FAIL to update as non-creator', ...);
    it('should FAIL to delete as non-creator', ...);
    it('should FAIL to access with invalid token', ...);
  });

  // Validation tests
  describe('Input Validation', () => {
    it('should FAIL with missing required fields', ...);
    it('should FAIL with invalid field values', ...);
    it('should FAIL with duplicate values', ...);
  });

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle non-existent ID (404)', ...);
    it('should handle empty list results', ...);
    it('should handle concurrent updates', ...);
  });
});
```

## Error Handling

### Common Issues

**Issue**: TypeScript errors about missing imports
**Solution**: Add missing imports manually:
```typescript
import { Reference } from '@lenne.tech/nest-server';
import { User } from '../../user/user.model';
```

**Issue**: CreateInput validation fails
**Solution**: Check parent's CreateInput for required fields and add them

**Issue**: Enum validation errors
**Solution**: Verify enum file exists and is properly imported

**Issue**: Tests fail due to missing required fields
**Solution**: Review CreateInput and ensure all required fields are provided in tests

**Issue**: Tests fail with 403 Forbidden
**Solution**:
1. Check `@Roles()` decorator - are you using the right user role?
2. Check `securityCheck()` - does it allow this user to see the data?
3. Check service `serviceOptions.roles` - are permissions checked correctly?
4. **Use the LEAST privileged user who is authorized** (not admin!)

**Issue**: Test passes with admin but should work with regular user
**Solution**: You're over-privileging! Analyze permissions and use the correct user:
- S_USER endpoint? → Use regular user token
- S_CREATOR endpoint? → Use creator token
- NEVER use admin when regular user would work

**Issue**: Security tests not failing as expected
**Solution**:
1. Verify `@Roles()` decorator is set correctly
2. Verify `securityCheck()` logic is correct
3. Add console.log to see what's happening
4. Security MUST be validated - fix the model/controller if tests don't fail

## ⚠️ CRITICAL: Security & Test Coverage Rules

### Rule 1: NEVER Weaken Security for Test Convenience

**❌ ABSOLUTELY FORBIDDEN:**
```typescript
// BEFORE (secure):
@Restricted(RoleEnum.ADMIN)
export class ProductController {
  @Roles(RoleEnum.S_USER)
  async createProduct() { ... }
}

// AFTER (FORBIDDEN - security weakened!):
// @Restricted(RoleEnum.ADMIN)  ← NEVER remove this!
export class ProductController {
  @Roles(RoleEnum.S_USER)
  async createProduct() { ... }
}
```

**🚨 CRITICAL RULE:**
- **NEVER remove or weaken `@Restricted()` decorators** on Controllers, Resolvers, Models, or Objects
- **NEVER change `@Roles()` decorators** to more permissive roles just to make tests pass
- **NEVER modify `securityCheck()` logic** to bypass security for testing

**If tests fail due to permissions:**
1. ✅ **CORRECT**: Adjust the test to use the appropriate user/token
2. ✅ **CORRECT**: Create test users with the required roles
3. ❌ **WRONG**: Weaken security to make tests pass

**Any security changes MUST:**
- Be discussed with the developer FIRST
- Have a solid business justification
- Be explicitly approved by the developer
- Be documented with the reason

### Rule 2: Understanding Permission Hierarchy

**⭐ Key Concept: Specific Overrides General**

The `@Restricted()` decorator on a class acts as a **security fallback** - if a method/property doesn't specify permissions, it inherits the class-level restriction. This is a **security-by-default** pattern.

**Example - Controller/Resolver:**
```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK: Protects everything by default
export class ProductController {

  @Roles(RoleEnum.S_EVERYONE)  // ← SPECIFIC: This method is MORE open
  async getPublicProducts() {
    // Anyone can access this
  }

  @Roles(RoleEnum.S_USER)      // ← SPECIFIC: This method is MORE open
  async getMyProducts() {
    // Any signed-in user can access this
  }

  async adminOnlyMethod() {     // ← NO DECORATOR: Falls back to @Restricted(ADMIN)
    // Only admins can access this
  }
}
```

**Why `@Restricted(RoleEnum.ADMIN)` MUST stay:**
- **Fail-safe**: If someone forgets `@Roles()` on a new method, it's protected by default
- **Security**: Without it, a method without `@Roles()` would be open to everyone
- **Intent**: Shows the class is security-sensitive

**Example - Model/Object:**
```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK: Protects all properties by default
export class Product extends CoreModel {

  @Restricted(RoleEnum.S_EVERYONE)  // ← SPECIFIC: This field is MORE open
  name: string;

  @Restricted(RoleEnum.S_USER)      // ← SPECIFIC: This field is MORE open
  description: string;

  secretInternalNotes: string;      // ← NO DECORATOR: Falls back to ADMIN only

  securityCheck(user: User) {
    // Controls who can see the entire object
    if (user?.hasRole(RoleEnum.ADMIN)) return this;
    if (this.isPublic) return this;
    return undefined;
  }
}
```

### Rule 3: Test Coverage Strategy

**🎯 Goal: Maximum Coverage WITHOUT Compromising Security**

**Approach:**
1. **Analyze permissions thoroughly** (as described in Phase 7)
2. **Create appropriate test users** for each permission level:
   ```typescript
   const adminUser = await testHelper.createUser({ roles: [RoleEnum.ADMIN] });
   const regularUser = await testHelper.createUser({ roles: [RoleEnum.S_USER] });
   const creatorUser = await testHelper.createUser({ roles: [RoleEnum.S_USER] });
   ```
3. **Test with the LEAST privileged user** who should have access
4. **Also test with UNAUTHORIZED users** to verify security
5. **Document why certain operations require certain roles**

**Coverage Priorities:**
1. **100% coverage** for all security-critical code (securityCheck, guards)
2. **100% coverage** for all endpoints (both success and failure cases)
3. **100% coverage** for all permission combinations
4. **90%+ coverage** for business logic
5. **Complete coverage** of error paths and edge cases

**Testing Strategy:**
```typescript
describe('ProductController', () => {
  describe('createProduct', () => {
    // Test with minimum required privilege
    it('should create product as S_USER', async () => {
      // ✅ Tests with least privileged user who should succeed
    });

    // Test security failure
    it('should FAIL to create product without auth', async () => {
      // ✅ Verifies security works
    });
  });

  describe('adminOnlyMethod', () => {
    it('should execute as admin', async () => {
      // ✅ Uses admin token (required for this method)
    });

    it('should FAIL for regular user', async () => {
      // ✅ Verifies fallback to @Restricted(ADMIN) works
    });

    it('should FAIL without auth', async () => {
      // ✅ Verifies security
    });
  });
});
```

### Rule 4: When Security Changes Are Necessary

**If you genuinely believe a security restriction is too strict:**

1. **STOP** - Do NOT make the change
2. **Analyze** - Why is the restriction failing the test?
3. **Document** - Prepare a clear explanation:
   - What restriction exists?
   - Why does it block the test?
   - What business case requires opening it?
   - What security risks does opening it introduce?
   - What mitigation strategies exist?
4. **Ask the developer**:
   ```
   "I've analyzed the permissions for [Method/Property] and found:
   - Current restriction: @Restricted(RoleEnum.ADMIN)
   - Test requirement: S_USER needs access to [do X]
   - Business justification: [explain why]
   - Security impact: [explain risks]
   - Mitigation: [how to minimize risk]

   Should I:
   A) Keep security as-is and adjust the test
   B) Change to @Restricted(RoleEnum.S_USER) with your approval
   C) Something else?"
   ```
5. **Wait for explicit approval** before changing ANY security decorator
6. **Document the decision** in code comments:
   ```typescript
   // Changed from ADMIN to S_USER on 2024-01-15
   // Reason: Users need to create their own products
   // Approved by: [Developer Name]
   @Restricted(RoleEnum.S_USER)
   ```

**Remember:**
- Security is NOT negotiable for test convenience
- Tests must adapt to security requirements, not vice versa
- When in doubt, keep it secure and ask

## Phase 8: Pre-Report Quality Review

**CRITICAL**: Before creating the final report, you MUST perform a comprehensive quality review:

### Step 1: Identify All Changes

Use git to identify all created and modified files:

```bash
git status --short
git diff --name-only
```

For each file, review:
- All newly created files
- All modified files
- File structure and organization

### Step 2: Test Management

**CRITICAL**: Ensure tests are created/updated for all changes:

#### Step 2.1: Analyze Existing Tests FIRST

**BEFORE creating or modifying ANY tests, you MUST thoroughly analyze existing tests**:

1. **Identify all existing test files**:
   ```bash
   # List all test directories and files
   ls -la tests/
   ls -la tests/modules/
   find tests -name "*.e2e-spec.ts" -type f
   ```

2. **Read multiple existing test files completely**:
   ```bash
   # Read at least 2-3 different module tests to understand patterns
   cat tests/modules/user.e2e-spec.ts
   cat tests/modules/<another-module>.e2e-spec.ts

   # Also check the common and project test files
   cat tests/common.e2e-spec.ts
   cat tests/project.e2e-spec.ts
   ```

3. **CRITICAL: Understand the TestHelper thoroughly**:

   **Before creating any tests, you MUST understand the TestHelper from @lenne.tech/nest-server**:

   ```bash
   # Read the TestHelper source code to understand its capabilities
   cat node_modules/@lenne.tech/nest-server/src/test/test.helper.ts
   ```

   **Analyze the TestHelper to understand**:
   - **Available methods**: What methods does TestHelper provide?
   - **Configuration options**: How can TestHelper be configured?
   - **GraphQL support**: How to use `graphQl()` method? What parameters does it accept?
   - **REST support**: How to use `rest()` method? What parameters does it accept?
   - **Authentication**: How does TestHelper handle tokens and authentication?
   - **Request building**: How are requests constructed? What options are available?
   - **Response handling**: How are responses processed? What format is returned?
   - **Error handling**: How does TestHelper handle errors and failures?
   - **Helper utilities**: What additional utilities are available?

   **Document your findings**:
   ```typescript
   // Example: Understanding TestHelper.graphQl()
   // Method signature: graphQl(options: GraphQLOptions, config?: RequestConfig)
   // GraphQLOptions: { name, type (QUERY/MUTATION), arguments, fields }
   // RequestConfig: { token, statusCode, headers }
   // Returns: Parsed response data or error

   // Example: Understanding TestHelper.rest()
   // Method signature: rest(method: HttpMethod, path: string, options?: RestOptions)
   // HttpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
   // RestOptions: { body, token, statusCode, headers }
   // Returns: Response data or error
   ```

   **Common TestHelper patterns to understand**:
   - How to execute GraphQL queries/mutations with `graphQl()`
   - How to execute REST requests with `rest()`
   - How to pass authentication tokens (same for both methods)
   - How to handle expected errors (statusCode parameter)
   - How to work with response data
   - How to structure test data
   - When to use GraphQL vs REST methods

   **Only after fully understanding TestHelper, proceed to next step.**

4. **Understand the testing approach used**:
   - Which test framework? (Jest, Mocha, etc.)
   - Which testing utilities? (@lenne.tech/nest-server testHelper, custom helpers)
   - How is the test app initialized? (beforeAll setup)
   - How are test users/auth handled?
   - How is test data created and cleaned up?
   - What assertion library? (expect, should, etc.)
   - Are there custom matchers?

5. **Document the patterns you observe**:
   - **Import patterns**: Which modules are imported? In what order?
   - **Setup patterns**: How is beforeAll/beforeEach structured?
   - **Auth patterns**: How do tests authenticate? Token handling?
   - **Test structure**: Describe blocks organization? Test naming conventions?
   - **CRUD patterns**: How are create/read/update/delete tested?
   - **Assertion patterns**: What assertions are used? How detailed?
   - **Cleanup patterns**: How is afterAll/afterEach structured?
   - **Error testing**: How are failures/validations tested?

6. **Verify existing tests run successfully**:
   ```bash
   # Run existing tests to ensure they pass
   npm run test:e2e

   # If any fail, understand why before proceeding
   # Your new/modified tests MUST NOT break existing tests
   ```

7. **Create a mental checklist**:
   - [ ] I have read and understand the TestHelper source code
   - [ ] I understand TestHelper methods and configuration
   - [ ] I understand how to use graphQl() method (GraphQL queries/mutations)
   - [ ] I understand how to use rest() method (REST endpoints)
   - [ ] I understand when to use graphQl() vs rest()
   - [ ] I understand TestHelper authentication and error handling
   - [ ] I understand which test helpers/utilities are used
   - [ ] I understand the authentication/authorization pattern
   - [ ] I understand the test data lifecycle (create/cleanup)
   - [ ] I understand the assertion patterns
   - [ ] I understand the error testing approach
   - [ ] All existing tests pass before I make changes

**Only after completing this analysis, proceed to create or modify tests.**

#### Step 2.1.1: Understanding Permissions and User Rights in Tests

**CRITICAL**: Before creating tests, you MUST understand the 3-layer permission system:

**Important Definitions**:

- **Admin User**: A user whose `roles` array contains `'admin'`
  ```typescript
  // Example admin user
  {
    id: '123',
    email: 'admin@test.com',
    roles: ['admin', 'user'] // ← Contains 'admin'
  }
  ```

- **Creator**: The user who created an object, identified by matching IDs
  ```typescript
  // User who created the object
  const user = { id: 'user-123', email: 'creator@test.com' };

  // Object created by this user
  const product = {
    id: 'product-456',
    name: 'Test Product',
    createdBy: 'user-123' // ← Matches user.id → This user is the CREATOR
  };

  // Different user (NOT the creator)
  const otherUser = { id: 'user-789', email: 'other@test.com' };
  // otherUser.id !== product.createdBy → NOT the creator!
  ```

**The Three Permission Layers**:

1. **Controller/Resolver Layer** (`@Roles()` decorator):
   - Controls WHO can call the endpoint
   - Example: `@Roles(RoleEnum.ADMIN)` → Only admins can call this endpoint
   - Example: `@Roles(RoleEnum.S_USER)` → All signed-in users can call

2. **Service Layer** (`serviceOptions.roles` parameter):
   - Controls what permissions are checked during service processing
   - Example: Update/Delete often require `[RoleEnum.ADMIN, RoleEnum.S_CREATOR]`
   - The creator can update/delete their own items

3. **Model Layer** (`securityCheck()` method):
   - Controls WHAT data is returned to the user
   - Standard implementation:
     ```typescript
     securityCheck(user: User, force?: boolean) {
       // Admins see everything (user.roles contains 'admin')
       if (force || user?.hasRole(RoleEnum.ADMIN)) {
         return this;
       }
       // Only creator can see their own data (user.id === this.createdBy)
       if (!equalIds(user, this.createdBy)) {
         return undefined; // Non-creator gets nothing!
       }
       return this;
     }
     ```
   - **Key checks**:
     - `user?.hasRole(RoleEnum.ADMIN)` → Returns `true` if `user.roles.includes('admin')`
     - `equalIds(user, this.createdBy)` → Returns `true` if `user.id === this.createdBy`

**Default Permission Behavior**:
- **Create**: Usually accessible to signed-in users (`RoleEnum.S_USER`)
- **Read/List**: Usually accessible to signed-in users, but securityCheck filters results
- **Update**: Only ADMIN or CREATOR (via `serviceOptions.roles` check)
- **Delete**: Only ADMIN or CREATOR (via `serviceOptions.roles` check)

**Analyzing Permissions Before Creating Tests**:

Before writing tests, check these 3 locations:

1. **Check Controller/Resolver decorators**:
   ```typescript
   // In product.resolver.ts
   @Roles(RoleEnum.ADMIN) // ← WHO can call this?
   @Query(() => Product)
   async getProduct(@Args('id') id: string) { ... }

   @Roles(RoleEnum.S_USER) // ← All signed-in users
   @Mutation(() => Product)
   async createProduct(@Args('input') input: ProductCreateInput) { ... }
   ```

2. **Check Model/Object `@Restricted` decorators**:
   ```typescript
   // In product.model.ts
   @Restricted(RoleEnum.ADMIN) // ← Model-level restriction
   export class Product extends CoreModel {

     @Restricted(RoleEnum.ADMIN) // ← Property-level restriction
     @UnifiedField()
     internalNotes?: string;
   }
   ```

3. **Check Model `securityCheck()` logic**:
   ```typescript
   // In product.model.ts
   securityCheck(user: User, force?: boolean) {
     // Admin check: user.roles contains 'admin'
     if (force || user?.hasRole(RoleEnum.ADMIN)) {
       return this; // Admin sees all
     }

     // Custom logic: Allow public products for everyone
     if (this.isPublic) {
       return this;
     }

     // Creator check: user.id === this.createdBy
     if (!equalIds(user, this.createdBy)) {
       return undefined; // Non-creator gets nothing
     }
     return this; // Creator sees their own product
   }
   ```

**Creating Appropriate Test Users**:

Based on permission analysis, create appropriate test users:

```typescript
describe('Product Module', () => {
  let testHelper: TestHelper;
  let adminToken: string;
  let userToken: string;
  let otherUserToken: string;
  let createdProductId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Admin user (user.roles contains 'admin')
    const adminAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'admin@test.com', password: 'admin' },
      fields: ['token', 'user { id email roles }']
    });
    adminToken = adminAuth.token;
    // adminAuth.user.roles = ['admin', 'user'] ← Contains 'admin'

    // Regular user (will be the creator of test objects)
    const userAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'user@test.com', password: 'user' },
      fields: ['token', 'user { id email roles }']
    });
    userToken = userAuth.token;
    // When this user creates an object → object.createdBy = userAuth.user.id

    // Another regular user (will NOT be the creator)
    const otherUserAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'other@test.com', password: 'other' },
      fields: ['token', 'user { id email roles }']
    });
    otherUserToken = otherUserAuth.token;
    // otherUserAuth.user.id !== object.createdBy → NOT the creator
  });
});
```

**Test Structure Based on Permissions**:

```typescript
describe('Product Module', () => {
  // ... setup with adminToken, userToken, otherUserToken

  describe('Create Product', () => {
    it('should create product as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Test Product', price: 99.99 } },
        fields: ['id', 'name', 'createdBy { id }']
      }, { token: userToken }); // ← Created by userToken

      expect(result.name).toBe('Test Product');
      // result.createdBy.id now equals userAuth.user.id
      // → userToken is the CREATOR of this product
      createdProductId = result.id;
    });
  });

  describe('Update Product', () => {
    it('should update product as creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 89.99 }
        },
        fields: ['id', 'price']
      }, { token: userToken }); // ← Creator: userAuth.user.id === product.createdBy

      expect(result.price).toBe(89.99);
    });

    it('should update product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 79.99 }
        },
        fields: ['id', 'price']
      }, { token: adminToken }); // ← Admin: adminAuth.user.roles contains 'admin'

      expect(result.price).toBe(79.99);
    });

    it('should fail to update product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 69.99 }
        },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Not creator: otherUserAuth.user.id !== product.createdBy

      expect(result.errors).toBeDefined();
    });
  });

  describe('Delete Product', () => {
    it('should delete product as creator', async () => {
      // First create a new product to delete
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'To Delete', price: 50 } },
        fields: ['id']
      }, { token: userToken });

      // Delete as creator
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: created.id },
        fields: ['id']
      }, { token: userToken }); // ← Creator: userAuth.user.id === created.createdBy

      expect(result.id).toBe(created.id);
    });

    it('should fail to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Not creator: otherUserAuth.user.id !== product.createdBy

      expect(result.errors).toBeDefined();
    });

    it('should delete any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: adminToken }); // ← Admin: adminAuth.user.roles contains 'admin'

      expect(result.id).toBe(createdProductId);
    });
  });
});
```

**Permission Testing Checklist**:

Before creating tests, verify:

- [ ] I have checked the `@Roles()` decorators in controllers/resolvers
- [ ] I have checked the `@Restricted()` decorators in models/objects
- [ ] I have reviewed the `securityCheck()` logic in models
- [ ] I understand who can CREATE items (usually S_USER)
- [ ] I understand who can READ items (S_USER + securityCheck filtering)
- [ ] I understand who can UPDATE items (usually ADMIN + S_CREATOR)
- [ ] I understand who can DELETE items (usually ADMIN + S_CREATOR)
- [ ] I have created appropriate test users (admin, creator, non-creator)
- [ ] My tests use the CREATOR token (user.id === object.createdBy) for update/delete operations
- [ ] My tests verify that non-creators (user.id !== object.createdBy) CANNOT update/delete
- [ ] My tests verify that admins (user.roles contains 'admin') CAN update/delete everything

**Common Permission Test Patterns**:

1. **Test with creator** (user.id === object.createdBy) → Should succeed
2. **Test with admin** (user.roles contains 'admin') → Should succeed
3. **Test with other user** (user.id !== object.createdBy) → Should fail (403)

**Only after understanding permissions, proceed to create tests.**

#### Step 2.2: For Newly Created Modules

**CRITICAL: Follow the correct test folder structure**:

The project uses a specific test organization:

1. **Module tests** (for modules in `src/server/modules/`):
   ```
   tests/modules/<module-name>.e2e-spec.ts
   ```
   - Each module gets its own test file directly in `tests/modules/`
   - Examples: `tests/modules/user.e2e-spec.ts`, `tests/modules/book.e2e-spec.ts`

2. **Common tests** (for common functionality in `src/server/common/`):
   ```
   tests/common.e2e-spec.ts
   ```
   - All common functionality (enums, objects, helpers) tested here
   - Single file for all common-related tests

3. **Project tests** (for everything else - root level, config, etc.):
   ```
   tests/project.e2e-spec.ts
   ```
   - General project-level tests
   - Configuration tests
   - Integration tests

**Determine correct test location**:

```bash
# BEFORE creating a test, ask yourself:
# - Is this a module in src/server/modules/? → tests/modules/<name>.e2e-spec.ts
# - Is this common functionality? → Add to tests/common.e2e-spec.ts
# - Is this project-level? → Add to tests/project.e2e-spec.ts

# Check existing test structure to confirm:
ls -la tests/
ls tests/modules/
```

**Create new test files** for modules following the patterns you identified:

```bash
# For a new module (e.g., Book)
tests/modules/book.e2e-spec.ts
```

**IMPORTANT**: Your new test file MUST:
1. **Match the exact structure** of existing test files
2. **Use the same imports** as existing tests
3. **Follow the same setup/cleanup pattern** (beforeAll, afterAll)
4. **Use the same test helpers/utilities** you observed
5. **Follow the same authentication pattern**
6. **Use the same assertion style**
7. **Follow the same naming conventions** for describe/it blocks

**Each new test file must include**:
1. All CRUD operations (create, find all, find by ID, update, delete)
2. Authorization tests (unauthorized should fail, authorized should succeed)
3. Required field validation (missing required fields should fail)
4. Proper test data setup and cleanup (beforeAll, afterAll)
5. Tests for any custom methods or relationships

**Ensure all prerequisites are met by analyzing existing tests**:

Before writing test code, identify ALL prerequisites from existing test files:

```bash
# Read an existing module test to understand prerequisites
cat tests/modules/user.e2e-spec.ts
```

**Common prerequisites to check**:
1. **Test data dependencies**:
   - Does the module reference other modules? (e.g., Book → User for borrowedBy)
   - Do you need to create related test data first?
   - Example: To test Book with borrowedBy: User, create test User first

2. **Authentication requirements**:
   - What roles/permissions are needed?
   - Do test users need to be created with specific roles?
   - Example: Admin user for create operations, regular user for read operations

3. **Database setup**:
   - Are there database constraints or required collections?
   - Do embedded objects or enums need to exist?

4. **Configuration**:
   - Are environment variables or config values needed?
   - Example: JWT secrets, database connections

**Pattern from existing tests**:
```typescript
// Example structure you should follow:
beforeAll(async () => {
  // 1. Initialize test app/module
  // 2. Set up database connection
  // 3. Create prerequisite test data (users, roles, etc.)
  // 4. Authenticate and get tokens
});

describe('Module Tests', () => {
  // Tests here
});

afterAll(async () => {
  // 1. Delete created test data (in reverse order)
  // 2. Clean up connections
  // 3. Close app
});
```

**CRITICAL**: Look at how existing tests handle prerequisites and replicate the exact same approach.

#### Step 2.3: For Modified Existing Modules

**Update existing test files** when you modify modules:

1. **FIRST: Read the existing test file completely**:
   ```bash
   # Find and read the test file for the module you modified
   find tests -name "*<module-name>*.e2e-spec.ts"
   cat tests/modules/<module-name>.e2e-spec.ts
   ```

2. **Understand what the existing tests cover**:
   - Which operations are tested?
   - Which properties are validated?
   - What edge cases are covered?
   - How is test data structured?

3. **Run existing tests to ensure they pass BEFORE your changes**:
   ```bash
   npm run test:e2e
   ```

4. **Review and update tests**:
   - **Added properties**: Add tests verifying new properties work correctly
   - **Changed validation**: Update tests to reflect new validation rules
   - **Added relationships**: Add tests for new references/embedded objects
   - **Changed required fields**: Update CreateInput tests accordingly
   - **Removed properties**: Remove related test assertions

5. **Verify test coverage**:
   - All new properties are tested
   - Changed behavior is verified
   - Edge cases are covered
   - Authorization still works correctly

6. **Run tests again to ensure your changes don't break anything**:
   ```bash
   npm run test:e2e
   ```

### Step 3: Compare with Existing Code

**Compare generated code with existing project code**:

1. **Read existing similar modules** to understand project patterns:
   ```bash
   # Example: If you created a User module, check existing modules
   ls src/server/modules/
   ```

2. **Check for consistency**:
   - Code style (indentation, spacing, formatting)
   - Import ordering and organization
   - Naming conventions (camelCase, PascalCase, kebab-case)
   - File structure and directory organization
   - Comment style and documentation
   - Decorator usage (@Field, @Prop, etc.)
   - Error handling patterns
   - Validation patterns

3. **Review property ordering**:
   - Verify alphabetical order in models
   - Verify alphabetical order in inputs
   - Verify alphabetical order in outputs
   - Check decorator consistency

### Step 4: Critical Analysis

**Analyze each file critically**:

1. **Style consistency**:
   - Does the code match the project's existing style?
   - Are imports grouped and ordered correctly?
   - Is indentation consistent with the project?
   - Are naming conventions followed?

2. **Structural consistency**:
   - Are decorators in the same order as existing code?
   - Is the file structure identical to existing modules?
   - Are descriptions formatted the same way?
   - Are relationships implemented consistently?

3. **Code quality**:
   - Are there any redundant imports?
   - Are there any missing imports?
   - Are descriptions meaningful and complete?
   - Are TypeScript types correctly used?

4. **Best practices**:
   - Are required fields properly marked?
   - Are nullable fields correctly configured?
   - Are references properly typed?
   - Are arrays correctly configured?

### Step 5: Automated Optimizations

**Apply automatic improvements**:

1. **Fix import ordering**:
   - External imports first (alphabetically)
   - @lenne.tech/nest-server imports next
   - Local imports last (alphabetically by path depth)

2. **Fix property ordering**:
   - Reorder all properties alphabetically in models
   - Reorder all properties alphabetically in inputs
   - Reorder all properties alphabetically in outputs

3. **Fix formatting**:
   - Ensure consistent indentation
   - Remove extra blank lines
   - Add missing blank lines between sections

4. **Fix descriptions**:
   - Ensure all follow "ENGLISH (DEUTSCH)" format
   - Add missing descriptions
   - Improve unclear descriptions

5. **Fix common patterns**:
   - Standardize decorator usage
   - Standardize validation patterns
   - Standardize error handling

### Step 6: Pre-Report Testing

**MANDATORY**: Run all tests before reporting:

```bash
# Run TypeScript compilation
npm run build

# Run linting
npm run lint

# Run all tests
npm run test:e2e

# If any fail, fix issues and repeat
```

**If tests fail**:
1. Analyze the error
2. Fix the issue
3. Re-run tests
4. Repeat until all tests pass

#### Debugging Failed Tests - Important Guidelines

**When tests fail, use systematic debugging with console.log statements:**

1. **Add debug messages in Controllers/Resolvers**:
   ```typescript
   // In controller/resolver - BEFORE service call
   console.log('🔵 [Controller] createProduct - Input:', input);
   console.log('🔵 [Controller] createProduct - User:', serviceOptions?.user);

   const result = await this.productService.create(input, serviceOptions);

   // AFTER service call
   console.log('🔵 [Controller] createProduct - Result:', result);
   ```

2. **Add debug messages in Services**:
   ```typescript
   // In service method
   console.log('🟢 [Service] create - Input:', input);
   console.log('🟢 [Service] create - ServiceOptions:', serviceOptions);

   const created = await super.create(input, serviceOptions);

   console.log('🟢 [Service] create - Created:', created);
   ```

3. **Understand the permissions system**:
   - **Controllers/Resolvers**: `@Roles()` decorator controls WHO can call the endpoint
   - **Services**: `serviceOptions.roles` controls what the service checks during processing
   - **Models**: `securityCheck()` method determines what data is returned to the user

4. **Default permission behavior**:
   - Only **Admin users** (user.roles contains 'admin') OR the **creator** (user.id === object.createdBy) of an element can access it
   - This is enforced in the `securityCheck()` method in models:
   ```typescript
   securityCheck(user: User, force?: boolean) {
     // Admin: user.roles contains 'admin'
     if (force || user?.hasRole(RoleEnum.ADMIN)) {
       return this; // Admin sees everything
     }
     // Creator: user.id === this.createdBy
     if (!equalIds(user, this.createdBy)) {
       return undefined; // Non-creator (user.id !== this.createdBy) gets nothing
     }
     return this; // Creator sees their own data
   }
   ```

5. **Debugging strategy for permission issues**:

   **Step 1**: Run failing test with Admin user first
   ```typescript
   // In test setup
   const adminToken = await testHelper.signIn('admin@test.com', 'admin-password');

   // Use admin token in test
   const result = await testHelper.graphQl({...}, { token: adminToken });
   ```

   **Step 2**: Analyze results
   - ✅ **Works with Admin, fails with normal user** → Permission issue (check Roles, securityCheck)
   - ❌ **Fails with Admin too** → Different issue (check logic, data, validation)

6. **Common permission issues and solutions**:

   | Problem | Cause | Solution |
   |---------|-------|----------|
   | 401/403 on endpoint | `@Roles()` too restrictive | Adjust decorator in controller/resolver |
   | Empty result despite data existing | `securityCheck()` returns undefined | Modify securityCheck logic or use Admin |
   | Service throws permission error | `serviceOptions.roles` check fails | Pass correct roles in serviceOptions |

7. **Remove debug messages after fixing**:
   ```bash
   # After tests pass, remove all console.log statements
   # Search for debug patterns
   grep -r "console.log" src/server/modules/your-module/

   # Remove them manually or with sed
   # Then verify tests still pass
   npm run test:e2e
   ```

**Debugging workflow example**:
```typescript
// 1. Test fails - add debugging
@Mutation(() => Product)
async createProduct(@Args('input') input: ProductCreateInput, @GraphQLServiceOptions() opts) {
  console.log('🔵 START createProduct', { input, user: opts?.user?.email });

  const result = await this.productService.create(input, opts);

  console.log('🔵 END createProduct', { result: result?.id });
  return result;
}

// In service
async create(input: ProductCreateInput, serviceOptions?: ServiceOptions) {
  console.log('🟢 Service create', { input, user: serviceOptions?.user?.email });

  const created = await super.create(input, serviceOptions);

  console.log('🟢 Service created', { id: created?.id, createdBy: created?.createdBy });
  return created;
}

// 2. Run test - observe output:
// 🔵 START createProduct { input: {...}, user: 'test@test.com' }
// 🟢 Service create { input: {...}, user: 'test@test.com' }
// 🟢 Service created { id: '123', createdBy: '456' }
// 🔵 END createProduct { result: undefined }  ← AHA! Result is undefined!

// 3. Check model securityCheck() - likely returns undefined for non-creator (user.id !== object.createdBy)
// 4. Fix: Either use Admin user (user.roles contains 'admin') or adjust securityCheck logic
// 5. Test passes → Remove console.log statements
// 6. Verify tests still pass
```

**Do not proceed to final report if**:
- TypeScript compilation fails
- Linting fails
- Any tests fail
- Console shows errors or warnings

### Step 7: Final Verification

Before reporting, verify:

- [ ] All files compared with existing code
- [ ] Code style matches project patterns
- [ ] All imports properly ordered
- [ ] All properties in alphabetical order
- [ ] All descriptions follow format
- [ ] **TestHelper source code read and understood**
- [ ] **TestHelper methods and configuration understood**
- [ ] **Existing tests analyzed BEFORE creating/modifying tests**
- [ ] **Existing tests passed BEFORE making changes**
- [ ] **Tests in correct location (tests/modules/<name>.e2e-spec.ts, tests/common.e2e-spec.ts, or tests/project.e2e-spec.ts)**
- [ ] **New test files created for all new modules**
- [ ] **Existing test files updated for all modified modules**
- [ ] **All prerequisites identified and handled (test data dependencies, auth, etc.)**
- [ ] **All new/modified tests follow exact patterns from existing tests**
- [ ] TypeScript compiles without errors
- [ ] Linter passes without warnings
- [ ] **All tests pass AFTER changes**
- [ ] No console errors or warnings

**Only after ALL checks pass, proceed to Final Report.**

## Final Report

After completing all tasks, provide:

1. **Summary of created components**:
   - Number of SubObjects created
   - Number of Objects created
   - Number of Modules created
   - Number of enum files created
   - Number of test files created

2. **Observations about data structure**:
   - Unusual patterns
   - Potential improvements
   - Missing relationships
   - Optimization suggestions

3. **Test results**:
   - All tests passing
   - Any failures and reasons

4. **Next steps**:
   - Manual adjustments needed
   - Additional features to consider

## Best Practices

1. **Always create dependencies first** (SubObjects before Modules that use them)
2. **Check for circular dependencies** in object relationships
3. **Use meaningful enum names** that match the domain
4. **Keep descriptions concise** but informative
5. **Test incrementally** (don't wait until all modules are created)
6. **Commit after each major component** (SubObjects, then Modules, then Tests)
7. **Use appropriate controller types** (Rest for simple CRUD, GraphQL for complex queries, Both for flexibility)
8. **Validate required fields** in tests to ensure data integrity
9. **Clean up test data** to avoid database pollution
10. **Document complex relationships** in code comments

## Working with This Skill

When you receive a specification:

1. **Parse completely** before starting any generation
2. **Ask clarifying questions** if specification is ambiguous
3. **Create detailed todo list** showing all steps
4. **Execute systematically** following the workflow
5. **Verify each step** before moving to next
6. **Report progress** using todo updates
7. **Provide comprehensive summary** at the end

This skill ensures complete, production-ready NestJS backend structures are generated efficiently and correctly from complex specifications.