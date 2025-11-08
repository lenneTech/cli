---
name: nest-server-generator-examples
version: 1.0.0
description: Complete examples for generating NestJS server structures from specifications
---

# NestJS Server Generator Examples

## Example 1: Library Management System

This example demonstrates all features:
- SubObjects (embedded data)
- Objects (base models)
- Modules with inheritance
- ENUMs
- Arrays
- Optional properties
- References between modules
- German/English descriptions

### Complete Specification

```
===========

SubObject: Author // Author information
- firstName: string // First name
- lastName: string // Last name
- birthDate?: Date // Date of birth
- nationality?: string // Nationality

===

SubObject: Publisher // Publisher details
- name: string // Publisher name
- city: string // City
- country: string // Country
- foundedYear?: number // Year founded

===

SubObject: Review // Book review
- rating: number // Rating (1-5)
- comment?: string // Review comment
- reviewerName: string // Name of reviewer
- reviewDate: Date // Review date

===

Object: BaseItem // Base library item
Properties:
- title: string // Titel
- description?: string // Beschreibung
- available: boolean // Verfügbar
- location: string // Standort

===

Module: Book // Book module

Model: Book // Buch
Extends: BaseItem
- isbn: string // ISBN-Nummer
- authors: Author[] // Autoren
- publisher: Publisher // Verlag
- publishYear: number // Erscheinungsjahr
- pageCount: number // Seitenzahl
- language: ENUM (ENGLISH, GERMAN, FRENCH, SPANISH, OTHER) // Sprache
- genre: ENUM (FICTION, NON_FICTION, SCIENCE, HISTORY, BIOGRAPHY, CHILDREN, FANTASY, MYSTERY, ROMANCE) // Genre
- coverImage?: string // Cover image URL
- reviews?: Review[] // Bewertungen
- borrowedBy?: Member // Current borrower

===

Module: Member // Library member module

Model: Member // Bibliotheksmitglied
- memberNumber: string // Mitgliedsnummer
- firstName: string // Vorname
- lastName: string // Nachname
- email: string // E-Mail-Adresse
- phone?: string // Telefonnummer
- joinDate: Date // Beitrittsdatum
- status: ENUM (ACTIVE, SUSPENDED, EXPIRED) // Status
- currentLoans: Book[] // Currently borrowed books

===

Module: Loan // Loan tracking module

Model: Loan // Ausleihe
- member: Member // Mitglied
- book: Book // Buch
- loanDate: Date // Ausleihdatum
- dueDate: Date // Fälligkeitsdatum
- returnDate?: Date // Rückgabedatum
- status: ENUM (ACTIVE, OVERDUE, RETURNED, LOST) // Status
- renewalCount: number // Anzahl der Verlängerungen
- fine?: number // Gebühr bei Verspätung

===========
```

### Generated Commands Sequence

#### Step 1: Create SubObjects

```bash
# Author SubObject
lt server object --name Author \
  --prop-name-0 birthDate --prop-type-0 Date --prop-nullable-0 true \
  --prop-name-1 firstName --prop-type-1 string \
  --prop-name-2 lastName --prop-type-2 string \
  --prop-name-3 nationality --prop-type-3 string --prop-nullable-3 true

# Publisher SubObject
lt server object --name Publisher \
  --prop-name-0 city --prop-type-0 string \
  --prop-name-1 country --prop-type-1 string \
  --prop-name-2 foundedYear --prop-type-2 number --prop-nullable-2 true \
  --prop-name-3 name --prop-type-3 string

# Review SubObject
lt server object --name Review \
  --prop-name-0 comment --prop-type-0 string --prop-nullable-0 true \
  --prop-name-1 rating --prop-type-1 number \
  --prop-name-2 reviewDate --prop-type-2 Date \
  --prop-name-3 reviewerName --prop-type-3 string
```

#### Step 2: Create Base Object

```bash
# BaseItem Object
lt server object --name BaseItem \
  --prop-name-0 available --prop-type-0 boolean \
  --prop-name-1 description --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 location --prop-type-2 string \
  --prop-name-3 title --prop-type-3 string
```

#### Step 3: Create Modules

```bash
# Member Module (create first as it's referenced by Book)
lt server module --name Member --controller Both \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 firstName --prop-type-1 string \
  --prop-name-2 joinDate --prop-type-2 Date \
  --prop-name-3 lastName --prop-type-3 string \
  --prop-name-4 memberNumber --prop-type-4 string \
  --prop-name-5 phone --prop-type-5 string --prop-nullable-5 true \
  --prop-name-6 status --prop-enum-6 MemberStatusEnum

# Book Module (references Member)
lt server module --name Book --controller Both \
  --prop-name-0 authors --prop-schema-0 Author --prop-array-0 true \
  --prop-name-1 borrowedBy --prop-type-1 ObjectId --prop-reference-1 Member --prop-nullable-1 true \
  --prop-name-2 coverImage --prop-type-2 string --prop-nullable-2 true \
  --prop-name-3 genre --prop-enum-3 BookGenreEnum \
  --prop-name-4 isbn --prop-type-4 string \
  --prop-name-5 language --prop-enum-5 BookLanguageEnum \
  --prop-name-6 pageCount --prop-type-6 number \
  --prop-name-7 publishYear --prop-type-7 number \
  --prop-name-8 publisher --prop-schema-8 Publisher \
  --prop-name-9 reviews --prop-schema-9 Review --prop-array-9 true --prop-nullable-9 true

# Add currentLoans to Member (after Book is created)
lt server addProp --type Module --element Member \
  --prop-name-0 currentLoans --prop-type-0 ObjectId --prop-reference-0 Book --prop-array-0 true

# Loan Module (references both Member and Book)
lt server module --name Loan --controller Both \
  --prop-name-0 book --prop-type-0 ObjectId --prop-reference-0 Book \
  --prop-name-1 dueDate --prop-type-1 Date \
  --prop-name-2 fine --prop-type-2 number --prop-nullable-2 true \
  --prop-name-3 loanDate --prop-type-3 Date \
  --prop-name-4 member --prop-type-4 ObjectId --prop-reference-4 Member \
  --prop-name-5 renewalCount --prop-type-5 number \
  --prop-name-6 returnDate --prop-type-6 Date --prop-nullable-6 true \
  --prop-name-7 status --prop-enum-7 LoanStatusEnum
```

#### Step 4: Handle Inheritance

Manually modify `book.model.ts`:

```typescript
// Change from:
import { CoreModel } from '@lenne.tech/nest-server';
export class Book extends CoreModel { ... }

// To:
import { BaseItem } from '../../common/objects/base-item/base-item.object';
export class Book extends BaseItem { ... }
```

Manually update `book.input.ts` and `book-create.input.ts`:

```typescript
// book-create.input.ts
// Add required fields from BaseItem:
// - title (required in BaseItem)
// - available (required in BaseItem)
// - location (required in BaseItem)
// - description (optional in BaseItem)
```

#### Step 5: Update Descriptions

Update all generated files to follow pattern: `"ENGLISH (DEUTSCH)"`:

```typescript
// Before:
@UnifiedField({ description: 'ISBN number' })
isbn: string;

// After:
@UnifiedField({ description: 'ISBN number (ISBN-Nummer)' })
isbn: string;
```

#### Step 6: Create Enum Files

```typescript
// src/server/common/enums/book-language.enum.ts
export enum BookLanguageEnum {
  ENGLISH = 'ENGLISH',
  GERMAN = 'GERMAN',
  FRENCH = 'FRENCH',
  SPANISH = 'SPANISH',
  OTHER = 'OTHER',
}

// src/server/common/enums/book-genre.enum.ts
export enum BookGenreEnum {
  FICTION = 'FICTION',
  NON_FICTION = 'NON_FICTION',
  SCIENCE = 'SCIENCE',
  HISTORY = 'HISTORY',
  BIOGRAPHY = 'BIOGRAPHY',
  CHILDREN = 'CHILDREN',
  FANTASY = 'FANTASY',
  MYSTERY = 'MYSTERY',
  ROMANCE = 'ROMANCE',
}

// src/server/common/enums/member-status.enum.ts
export enum MemberStatusEnum {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
}

// src/server/common/enums/loan-status.enum.ts
export enum LoanStatusEnum {
  ACTIVE = 'ACTIVE',
  OVERDUE = 'OVERDUE',
  RETURNED = 'RETURNED',
  LOST = 'LOST',
}
```

#### Step 7: Create API Tests

```typescript
// test/book/book.controller.test.ts
import { TestHelper, TestGraphQLType } from '@lenne.tech/nest-server';

describe('Book Controller', () => {
  let testHelper: TestHelper;
  let adminToken: string;
  let createdBookId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Sign in as admin
    const authResult = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'admin@test.com', password: 'password' },
      fields: ['token']
    });
    adminToken = authResult.token;
  });

  afterAll(async () => {
    // Clean up created book
    if (createdBookId) {
      await testHelper.graphQl({
        name: 'deleteBook',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdBookId },
        fields: ['id']
      }, { token: adminToken });
    }
  });

  it('should create book with all required fields', async () => {
    const result = await testHelper.graphQl({
      name: 'createBook',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          isbn: '978-3-16-148410-0',
          title: 'Test Book',
          description: 'A test book',
          available: true,
          location: 'Shelf A1',
          authors: [{
            firstName: 'John',
            lastName: 'Doe'
          }],
          publisher: {
            name: 'Test Publisher',
            city: 'Berlin',
            country: 'Germany'
          },
          publishYear: 2023,
          pageCount: 300,
          language: 'ENGLISH',
          genre: 'FICTION'
        }
      },
      fields: ['id', 'isbn', 'title', 'pageCount']
    }, { token: adminToken });

    expect(result.isbn).toBe('978-3-16-148410-0');
    createdBookId = result.id;
  });

  it('should fail without required fields', async () => {
    const result = await testHelper.graphQl({
      name: 'createBook',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          isbn: '978-3-16-148410-1'
          // Missing required fields
        }
      },
      fields: ['id']
    }, { token: adminToken, statusCode: 400 });

    expect(result.errors).toBeDefined();
  });

  it('should get all books', async () => {
    const result = await testHelper.graphQl({
      name: 'books',
      type: TestGraphQLType.QUERY,
      fields: ['id', 'isbn', 'title']
    }, { token: adminToken });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should update book', async () => {
    const result = await testHelper.graphQl({
      name: 'updateBook',
      type: TestGraphQLType.MUTATION,
      arguments: {
        id: createdBookId,
        input: { pageCount: 350 }
      },
      fields: ['id', 'pageCount']
    }, { token: adminToken });

    expect(result.pageCount).toBe(350);
  });

  it('should delete book', async () => {
    const result = await testHelper.graphQl({
      name: 'deleteBook',
      type: TestGraphQLType.MUTATION,
      arguments: { id: createdBookId },
      fields: ['id']
    }, { token: adminToken });

    expect(result.id).toBe(createdBookId);
    createdBookId = null;
  });
});

// For REST API tests
// test/book/book.controller.rest.test.ts
describe('Book Controller (REST)', () => {
  let testHelper: TestHelper;
  let adminToken: string;
  let createdBookId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);
    const authResult = await testHelper.rest('/auth/sign-in', {
      method: 'POST',
      payload: { email: 'admin@test.com', password: 'password' }
    });
    adminToken = authResult.token;
  });

  it('should create book via REST', async () => {
    const result = await testHelper.rest('/books', {
      method: 'POST',
      payload: {
        isbn: '978-3-16-148410-0',
        title: 'Test Book',
        available: true,
        location: 'Shelf A1',
        // ... other required fields
      },
      token: adminToken
    });

    expect(result.isbn).toBe('978-3-16-148410-0');
    createdBookId = result.id;
  });

  it('should get all books via REST', async () => {
    const result = await testHelper.rest('/books', { token: adminToken });
    expect(Array.isArray(result)).toBe(true);
  });

  afterAll(async () => {
    if (createdBookId) {
      await testHelper.rest(`/books/${createdBookId}`, {
        method: 'DELETE',
        token: adminToken
      });
    }
  });
});
```

### Execution Todo List Example

When processing this specification, create this todo list:

```
1. Create Author SubObject
2. Create Publisher SubObject
3. Create Review SubObject
4. Create BaseItem Object
5. Create Member Module
6. Create Book Module
7. Add currentLoans property to Member
8. Create Loan Module
9. Modify Book model to extend BaseItem
10. Update Book CreateInput with BaseItem required fields
11. Update all descriptions to "ENGLISH (DEUTSCH)" format
12. Create BookLanguageEnum file
13. Create BookGenreEnum file
14. Create MemberStatusEnum file
15. Create LoanStatusEnum file
16. Create Book controller tests
17. Create Book resolver tests
18. Create Member controller tests
19. Create Member resolver tests
20. Create Loan controller tests
21. Create Loan resolver tests
22. Run all tests
23. Verify all tests pass
24. Verify no TypeScript errors
25. Run lint and fix
26. Provide summary
```

## Example 2: Hotel Booking System (Minimal)

A simpler example focusing on basic features:

```
===========

SubObject: ContactDetails // Contact information
- email: string // Email address
- phone: string // Phone number

===

Module: Guest // Guest module

Model: Guest // Hotel guest
- name: string // Full name
- contact: ContactDetails // Contact information
- checkInDate: Date // Check-in date
- checkOutDate: Date // Check-out date
- roomNumber: string // Room number
- status: ENUM (CHECKED_IN, CHECKED_OUT, RESERVED, CANCELLED) // Booking status

===========
```

### Commands

```bash
# SubObject
lt server object --name ContactDetails \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 phone --prop-type-1 string

# Module
lt server module --name Guest --controller Both \
  --prop-name-0 checkInDate --prop-type-0 Date \
  --prop-name-1 checkOutDate --prop-type-1 Date \
  --prop-name-2 contact --prop-schema-2 ContactDetails \
  --prop-name-3 name --prop-type-3 string \
  --prop-name-4 roomNumber --prop-type-4 string \
  --prop-name-5 status --prop-enum-5 GuestStatusEnum

# Enum file
# src/server/common/enums/guest-status.enum.ts
export enum GuestStatusEnum {
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  RESERVED = 'RESERVED',
  CANCELLED = 'CANCELLED',
}
```

## Key Patterns Demonstrated

### 1. SubObject with Arrays
```
- authors: Author[] // Multiple authors
```
→ `--prop-schema-X Author --prop-array-X true`

### 2. Optional Fields
```
- description?: string // Optional description
```
→ `--prop-nullable-X true`

### 3. Enum Properties
```
- status: ENUM (ACTIVE, INACTIVE) // Status
```
→ `--prop-enum-X StatusEnum` + create enum file

### 4. Module References
```
- borrowedBy?: Member // Reference to member
```
→ `--prop-type-X ObjectId --prop-reference-X Member --prop-nullable-X true`

### 5. Inheritance
```
Extends: BaseItem
```
→ Manually change model to extend BaseItem and update inputs

### 6. Circular References
```
Member has currentLoans: Book[]
Book has borrowedBy?: Member
```
→ Create both modules first, then use `addProp` for the second reference

## Best Practices from Examples

1. **Create SubObjects first**: Author, Publisher, Review before Book
2. **Create referenced modules early**: Member before Book (for borrowedBy)
3. **Handle circular refs with addProp**: Add currentLoans to Member after Book exists
4. **Alphabetical ordering**: All properties sorted in final files
5. **Proper descriptions**: "ENGLISH (DEUTSCH)" format throughout
6. **Complete enum files**: Create all enums immediately after modules
7. **Comprehensive tests**: Cover all CRUD operations and edge cases
8. **Quality review before reporting**: ALWAYS perform comprehensive quality review

## Quality Review Workflow Example

**CRITICAL**: Before creating the final report, ALWAYS perform this quality review:

```bash
# Step 1: Identify all changes
git status --short
git diff --name-only

# Step 2: Test Management

# Step 2.1: FIRST - Analyze existing tests thoroughly
ls -la tests/
ls -la tests/modules/
find tests -name "*.e2e-spec.ts" -type f

# Understand the test folder structure:
# - tests/modules/<module-name>.e2e-spec.ts - for modules
# - tests/common.e2e-spec.ts - for common functionality
# - tests/project.e2e-spec.ts - for project-level tests

# Read multiple test files to understand patterns
cat tests/modules/user.e2e-spec.ts
cat tests/modules/<another-module>.e2e-spec.ts
cat tests/common.e2e-spec.ts
cat tests/project.e2e-spec.ts

# CRITICAL: Read and understand TestHelper source code
cat node_modules/@lenne.tech/nest-server/src/test/test.helper.ts

# Document TestHelper understanding:
# - Available methods: graphQl(), rest(), constructor, initialization
# - graphQl() signature: (options: GraphQLOptions, config?: RequestConfig)
#   - GraphQLOptions: { name, type (QUERY/MUTATION), arguments, fields }
#   - RequestConfig: { token, statusCode, headers }
# - rest() signature: (method: HttpMethod, path: string, options?: RestOptions)
#   - HttpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
#   - RestOptions: { body, token, statusCode, headers }
# - Authentication: Pass token via config.token (both methods)
# - Error handling: Specify expected statusCode for error cases
# - Response: Returns parsed data directly
# - When to use: graphQl() for GraphQL endpoints, rest() for REST endpoints

# Document observed patterns:
# - Test framework: Jest
# - Test helper: TestHelper from @lenne.tech/nest-server
# - Auth: Token-based via signIn mutation
# - Setup: beforeAll initializes app and gets admin token
# - Cleanup: afterAll deletes test data
# - Assertions: expect() with Jest matchers
# - Prerequisites: How are test users/related data created?

# Verify existing tests pass BEFORE making changes
npm run test:e2e

# Step 2.2: For new modules - create test files in correct location
# Example: Created Book module, need to create tests

# IMPORTANT: Determine correct test location first!
# - Module in src/server/modules/book? → tests/modules/book.e2e-spec.ts
# - Common object/enum? → Add to tests/common.e2e-spec.ts
# - Project-level? → Add to tests/project.e2e-spec.ts

# Create new test file EXACTLY matching the pattern observed
# tests/modules/book.e2e-spec.ts with:
# - Same imports as existing tests
# - Same beforeAll/afterAll structure
# - Same authentication pattern
# - Same prerequisite handling (e.g., create User first if Book needs User)
# - Same assertion style
# - All CRUD operations
# - Authorization tests
# - Required field validation

# Step 2.3: For modified modules - update existing tests
find tests -name "*user*.e2e-spec.ts"
cat tests/modules/user.e2e-spec.ts  # Read first!

# Run tests before modifying
npm run test:e2e

# If you added a property to User, update tests to verify it
# Run tests after modifying to ensure nothing broke
npm run test:e2e

# Step 3: Compare with existing code
# Read existing modules to understand project patterns
cat src/server/modules/user/user.model.ts
cat src/server/modules/user/inputs/user-create.input.ts

# Step 3: Critical analysis
# For each generated file, check:
# - Import ordering matches existing code
# - Property ordering is alphabetical
# - Decorator patterns match existing code
# - Description format matches project style
# - Indentation and formatting is consistent

# Step 4: Apply optimizations
# Fix any inconsistencies found:
# - Reorder imports
# - Reorder properties
# - Fix formatting
# - Improve descriptions

# Step 5: Run all tests
npm run build
npm run lint
npm run test:e2e

# Step 6: Fix any failures and repeat
# If tests fail:
# - Analyze error
# - Fix issue
# - Re-run tests
# - Repeat until all pass

# Only after ALL checks pass → Create Final Report
```

**Example findings during quality review**:

```
Step 2.1: Analyzed existing tests
✅ Listed test structure: tests/modules/, tests/common.e2e-spec.ts, tests/project.e2e-spec.ts
✅ Read 3 existing test files (user, role, profile)
✅ Read and analyzed TestHelper source code (node_modules/@lenne.tech/nest-server/src/test/test.helper.ts)
✅ Documented TestHelper:
  - graphQl() method: signature, GraphQLOptions, RequestConfig
  - rest() method: signature, HttpMethod, RestOptions
  - When to use graphQl() vs rest()
  - Authentication handling (token in config for both methods)
  - Error handling (statusCode parameter)
  - Response format and parsing
✅ Documented patterns: Jest + TestHelper, token auth, beforeAll/afterAll cleanup
✅ Documented prerequisites: Test users created first, then module-specific data
✅ Verified all existing tests pass (23/23 passing)

❌ Found: New Book module created but no test file exists
✅ Fixed: Created tests/modules/book.e2e-spec.ts following exact pattern
  - Placed in correct location: tests/modules/book.e2e-spec.ts (not tests/book/ or tests/modules/book/)
  - Matched imports structure
  - Matched beforeAll/afterAll pattern
  - Identified prerequisites: Book references User for borrowedBy
  - Created test User first in beforeAll
  - Matched authentication approach
  - Matched assertion style

❌ Found: Modified User module (added 'phone' property) but tests not updated
✅ Fixed:
  - Read existing tests/modules/user.e2e-spec.ts first
  - Ran tests before changes (all passing)
  - Updated test to verify 'phone' property in create/update operations
  - Ran tests after changes (all passing)

❌ Found: Import ordering differs from existing modules
✅ Fixed: Reordered imports to match project pattern

❌ Found: Properties not alphabetically ordered in Book model
✅ Fixed: Reordered all properties alphabetically

❌ Found: Description format inconsistent ("German only" vs "ENGLISH (DEUTSCH)")
✅ Fixed: Updated all descriptions to "ENGLISH (DEUTSCH)" format

❌ Found: Test missing required field validation
✅ Fixed: Added test case for missing required fields

❌ Found: Test cleanup not following project pattern
✅ Fixed: Updated afterAll hook to match existing test cleanup patterns

✅ All tests passing
✅ Linter passing
✅ TypeScript compiling without errors

→ Ready for Final Report
```

**This quality review ensures**:
- Generated code matches project patterns perfectly
- No style inconsistencies
- **TestHelper thoroughly understood before creating tests**
- **TestHelper used correctly (graphQl() and rest() methods, authentication, error handling)**
- **Tests in correct folder structure (tests/modules/<name>.e2e-spec.ts, tests/common.e2e-spec.ts, tests/project.e2e-spec.ts)**
- **All new modules have corresponding test files**
- **All modified modules have updated tests**
- **All test prerequisites identified and handled correctly**
- **Tests follow existing project test patterns exactly**
- All tests pass before reporting
- Professional, production-ready code