---
name: nest-server-generator
version: 1.0.3
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

**Before you start ANY work, understand these NON-NEGOTIABLE rules:**

### ⛔ NEVER Do This:
1. **NEVER remove or weaken `@Restricted()` decorators**
2. **NEVER change `@Roles()` decorators** to more permissive roles
3. **NEVER modify `securityCheck()` logic** to bypass security
4. **NEVER remove class-level `@Restricted(RoleEnum.ADMIN)`**

### ✅ ALWAYS Do This:
1. **ALWAYS analyze permissions BEFORE writing tests**
2. **ALWAYS test with the LEAST privileged user** who is authorized
3. **ALWAYS adapt tests to security requirements**, never vice versa
4. **ALWAYS ask developer for approval** before changing ANY security decorator

**📖 For complete security rules, testing guidelines, and examples, see: `security-rules.md`**

## 🚨 CRITICAL: NEVER USE `declare` KEYWORD FOR PROPERTIES

**⚠️ DO NOT use the `declare` keyword when defining properties in classes!**

### Quick Rule

```typescript
// ❌ WRONG
export class ProductCreateInput extends ProductInput {
  declare name: string;  // Decorator won't work!
}

// ✅ CORRECT
export class ProductCreateInput extends ProductInput {
  @UnifiedField({ description: 'Product name' })
  name: string;  // Decorator works properly
}
```

**Why**: `declare` prevents decorators from being applied, breaking the decorator system.

**📖 For detailed explanation and correct patterns, see: `declare-keyword-warning.md`**

## 🚨 CRITICAL: DESCRIPTION MANAGEMENT

**⚠️ COMMON MISTAKE:** Descriptions are often applied inconsistently. You MUST follow this process for EVERY component.

### 3-Step Process

**1. Extract descriptions** from user's `// comments`

**2. Format correctly:**
- English input → `'Product name'`
- German input → `'Product name (Produktname)'`
- **⚠️ Fix typos ONLY, NEVER change wording!**

**3. Apply EVERYWHERE:**
- Model file
- Create Input file
- Update Input file
- Object files (if SubObject)
- Class-level @ObjectType() decorators

**📖 For detailed formatting rules, examples, and verification checklist, see: `description-management.md`**

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

The lenne.tech CLI supports project-level configuration via `lt.config.json` files to set default values for commands.

**📖 For complete configuration guide including structure, options, and examples, see: `configuration.md`**

**Quick reference:**
- **Location**: Project root or parent directories
- **Priority**: CLI parameters > Interactive input > Config file > Defaults
- **Key option**: `commands.server.module.controller` - Sets default controller type ("Rest" | "GraphQL" | "Both" | "auto")

**Example config:**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "Rest",
        "skipLint": false
      }
    }
  }
}
```

**Initialize config**: `lt config init`
**Show current config**: `lt config show`

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

**Exception: Direct database/service access for test setup/cleanup ONLY**

Direct database or service access is ONLY allowed for:

- ✅ **Test Setup (beforeAll/beforeEach)**:
  - Setting user roles in database: `await db.collection('users').updateOne({ _id: userId }, { $set: { roles: ['admin'] } })`
  - Setting verified flag: `await db.collection('users').updateOne({ _id: userId }, { $set: { verified: true } })`
  - Creating prerequisite test data that can't be created via API

- ✅ **Test Cleanup (afterAll/afterEach)**:
  - Deleting test objects: `await db.collection('products').deleteMany({ createdBy: testUserId })`
  - Cleaning up test data: `await db.collection('users').deleteOne({ email: 'test@example.com' })`

- ❌ **NEVER for testing functionality**:
  - Don't call `userService.create()` to test user creation - use API endpoint!
  - Don't call `productService.update()` to test updates - use API endpoint!
  - Don't access database to verify results - query via API instead!

**Example of correct usage:**

```typescript
describe('Product Tests', () => {
  let adminToken: string;
  let userId: string;

  beforeAll(async () => {
    // ✅ ALLOWED: Direct DB access for setup
    const user = await testHelper.rest('/auth/signup', {
      method: 'POST',
      payload: { email: 'admin@test.com', password: 'password' }
    });
    userId = user.id;

    // ✅ ALLOWED: Direct DB manipulation for test setup
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles: ['admin'], verified: true } }
    );

    // Get token via API
    const auth = await testHelper.rest('/auth/signin', {
      method: 'POST',
      payload: { email: 'admin@test.com', password: 'password' }
    });
    adminToken = auth.token;
  });

  it('should create product', async () => {
    // ✅ CORRECT: Test via API
    const result = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: { name: 'Test Product' },
      token: adminToken
    });

    expect(result.name).toBe('Test Product');

    // ❌ WRONG: Don't verify via DB
    // const dbProduct = await db.collection('products').findOne({ _id: result.id });

    // ✅ CORRECT: Verify via API
    const fetched = await testHelper.rest(`/api/products/${result.id}`, {
      method: 'GET',
      token: adminToken
    });
    expect(fetched.name).toBe('Test Product');
  });

  afterAll(async () => {
    // ✅ ALLOWED: Direct DB access for cleanup
    await db.collection('products').deleteMany({ createdBy: userId });
    await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
  });
});
```

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

**This section provides detailed rules for security and testing. It's duplicated at the beginning of this file for visibility.**

**📖 For the complete content with all rules, examples, and testing strategies, see: `security-rules.md`**

**Quick reminder - Core rules:**
1. **NEVER weaken @Restricted or @Roles decorators** to make tests pass
2. **NEVER modify securityCheck() logic** to bypass security
3. **ALWAYS test with least privileged user** who is authorized
4. **ALWAYS create appropriate test users** for each permission level
5. **ALWAYS ask developer** before changing ANY security decorator
6. **Aim for 80-100% test coverage** without compromising security

**Testing approach:**
- Analyze permissions first
- Create test users for each role
- Test happy path with appropriate user
- Test security failures (403 responses)
- Document why certain roles are required

## Phase 8: Pre-Report Quality Review

**CRITICAL**: Before creating the final report, you MUST perform a comprehensive quality review.

**📖 For the complete quality review process with all steps, checklists, and examples, see: `quality-review.md`**

**Quick overview - 7 steps:**

1. **Identify All Changes**: Use git to identify all created/modified files
2. **Test Management**: 
   - Analyze existing tests FIRST (understand TestHelper, patterns, permissions)
   - Create new test files for newly created modules (in `tests/modules/`)
   - Update existing test files for modified modules
   - Follow exact patterns from existing tests
3. **Compare with Existing Code**: Check consistency (style, structure, naming)
4. **Critical Analysis**: Verify style, structure, code quality, best practices
5. **Automated Optimizations**: Fix import ordering, property ordering, formatting, descriptions
6. **Pre-Report Testing**: Run build, lint, and all tests (must all pass!)
7. **Final Verification**: Complete checklist before proceeding to Final Report

**Critical reminders:**
- [ ] **TestHelper thoroughly understood** (read source code, understand graphQl() and rest() methods)
- [ ] **Existing tests analyzed** BEFORE creating new tests
- [ ] **Permission system understood** (3 layers: Controller @Roles, Service options, Model securityCheck)
- [ ] **Tests in correct location** (tests/modules/, tests/common.e2e-spec.ts, or tests/project.e2e-spec.ts)
- [ ] **All tests pass** before reporting

**Permission testing approach:**
- Admin users: `user.roles.includes('admin')`
- Creators: `user.id === object.createdBy`
- Always test with appropriate user (creator for update/delete, admin for everything)
- Test security failures (403 responses)

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