---
name: story-tdd-examples
version: 1.0.0
description: Complete examples for Test-Driven Development workflow with NestJS story tests
---

# Story-Based TDD Examples

This document provides complete examples of the TDD workflow for different types of user stories.

## Example 1: Simple CRUD Feature - Product Reviews

### Story Requirement

```
As a user, I want to add reviews to products so that I can share my experience with other customers.

Acceptance Criteria:
- Users can create a review with rating (1-5) and comment
- Rating is required, comment is optional
- Only authenticated users can create reviews
- Users can view all reviews for a product
- Each review shows author name and creation date
```

### Step 1: Story Analysis

**Analysis notes:**
- New feature, likely needs new Review module
- Needs relationship between Review and Product
- Security: Only authenticated users (S_USER role minimum)
- No mention of update/delete, so only CREATE and READ operations

**Questions to clarify:**
- Can users edit their reviews? (Assuming NO for this example)
- Can users review a product multiple times? (Assuming NO)
- What validation for rating? (Assuming 1-5 integer)

### Step 2: Create Story Test

**File:** `test/stories/product-review.story.test.ts`

```typescript
import {
  ConfigService,
  HttpExceptionLogFilter,
  TestGraphQLType,
  TestHelper,
} from '@lenne.tech/nest-server';
import { Test, TestingModule } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';
import { MongoClient, ObjectId } from 'mongodb';

import envConfig from '../../src/config.env';
import { RoleEnum } from '../../src/server/common/enums/role.enum';
import { ProductService } from '../../src/server/modules/product/product.service';
import { ReviewService } from '../../src/server/modules/review/review.service';
import { UserService } from '../../src/server/modules/user/user.service';
import { imports, ServerModule } from '../../src/server/server.module';

describe('Product Review Story', () => {
  // Test environment properties
  let app;
  let testHelper: TestHelper;

  // Database
  let connection;
  let db;

  // Services
  let userService: UserService;
  let productService: ProductService;
  let reviewService: ReviewService;

  // Global test data
  let gAdminToken: string;
  let gAdminId: string;
  let gUserToken: string;
  let gUserId: string;
  let gProductId: string;

  // Track created entities for cleanup
  let createdReviewIds: string[] = [];

  beforeAll(async () => {
    // Start server for testing
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [...imports, ServerModule],
      providers: [
        UserService,
        ProductService,
        ReviewService,
        {
          provide: 'PUB_SUB',
          useValue: new PubSub(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionLogFilter());
    app.setBaseViewsDir(envConfig.templates.path);
    app.setViewEngine(envConfig.templates.engine);
    await app.init();

    testHelper = new TestHelper(app);
    userService = moduleFixture.get(UserService);
    productService = moduleFixture.get(ProductService);
    reviewService = moduleFixture.get(ReviewService);

    // Connection to database
    connection = await MongoClient.connect(envConfig.mongoose.uri);
    db = await connection.db();

    // Create admin user
    const adminPassword = Math.random().toString(36).substring(7);
    const adminEmail = `admin-${adminPassword}@test.com`;
    const adminSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: adminEmail,
          firstName: 'Admin',
          password: adminPassword,
        },
      },
      fields: ['token', { user: ['id', 'email', 'roles'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gAdminId = adminSignUp.user.id;
    gAdminToken = adminSignUp.token;

    // Set admin role
    await userService.update(gAdminId, { roles: [RoleEnum.ADMIN] }, gAdminId);

    // Create normal user
    const userPassword = Math.random().toString(36).substring(7);
    const userEmail = `user-${userPassword}@test.com`;
    const userSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: userEmail,
          firstName: 'Test',
          password: userPassword,
        },
      },
      fields: ['token', { user: ['id', 'email'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gUserId = userSignUp.user.id;
    gUserToken = userSignUp.token;

    // Create test product
    const product = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: {
        name: 'Test Product',
        price: 99.99,
      },
      token: gAdminToken,
    });
    gProductId = product.id;
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete all test data created during tests
    try {
      // Delete all created reviews
      if (createdReviewIds.length > 0) {
        await db.collection('reviews').deleteMany({
          _id: { $in: createdReviewIds.map(id => new ObjectId(id)) }
        });
      }

      // Delete test product
      if (gProductId) {
        await db.collection('products').deleteOne({ _id: new ObjectId(gProductId) });
      }

      // Delete test users
      if (gUserId) {
        await db.collection('users').deleteOne({ _id: new ObjectId(gUserId) });
      }
      if (gAdminId) {
        await db.collection('users').deleteOne({ _id: new ObjectId(gAdminId) });
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }

    await connection.close();
    await app.close();
  });

  describe('Creating Reviews', () => {
    it('should allow authenticated user to create review with rating and comment', async () => {
      const review = await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          rating: 5,
          comment: 'Excellent product!',
        },
        token: gUserToken,
      });

      expect(review).toMatchObject({
        rating: 5,
        comment: 'Excellent product!',
        authorId: gUserId,
      });
      expect(review.id).toBeDefined();
      expect(review.createdAt).toBeDefined();

      // Track for cleanup
      createdReviewIds.push(review.id);
    });

    it('should allow review with rating only (no comment)', async () => {
      const review = await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          rating: 4,
        },
        token: gUserToken,
      });

      expect(review.rating).toBe(4);
      expect(review.comment).toBeUndefined();

      // Track for cleanup
      createdReviewIds.push(review.id);
    });

    it('should reject review without rating', async () => {
      await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          comment: 'Missing rating',
        },
        statusCode: 400,
        token: gUserToken,
      });
    });

    it('should reject review with invalid rating', async () => {
      await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          rating: 6, // Invalid: must be 1-5
        },
        statusCode: 400,
        token: gUserToken,
      });
    });

    it('should reject unauthenticated review creation', async () => {
      await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          rating: 5,
          comment: 'Trying without auth',
        },
        statusCode: 401,
      });
    });
  });

  describe('Viewing Reviews', () => {
    let createdReviewId: string;

    beforeAll(async () => {
      // Create a review for testing
      const review = await testHelper.rest('/api/reviews', {
        method: 'POST',
        payload: {
          productId: gProductId,
          rating: 5,
          comment: 'Great product',
        },
        token: gUserToken,
      });
      createdReviewId = review.id;

      // Track for cleanup
      createdReviewIds.push(review.id);
    });

    it('should allow anyone to view product reviews', async () => {
      const reviews = await testHelper.rest(`/api/products/${gProductId}/reviews`);

      expect(reviews).toBeInstanceOf(Array);
      expect(reviews.length).toBeGreaterThan(0);

      const review = reviews.find(r => r.id === createdReviewId);
      expect(review).toMatchObject({
        rating: 5,
        comment: 'Great product',
      });
      expect(review.author).toBeDefined();
      expect(review.createdAt).toBeDefined();
    });

    it('should return empty array for product with no reviews', async () => {
      // Create product without reviews
      const newProduct = await testHelper.rest('/api/products', {
        method: 'POST',
        payload: {
          name: 'New Product',
          price: 49.99,
        },
        token: gAdminToken,
      });

      const reviews = await testHelper.rest(`/api/products/${newProduct.id}/reviews`);
      expect(reviews).toEqual([]);
    });
  });
});
```

### Step 3-5: Implementation Iteration

**First run - Expected failures:**
```
❌ POST /api/reviews → 404 (endpoint doesn't exist)
❌ GET /api/products/:id/reviews → 404 (endpoint doesn't exist)
```

**Implementation (using nest-server-generator):**
```bash
# Create Review module
lt server module Review --no-interactive

# Add properties
lt server addProp Review productId:string --no-interactive
lt server addProp Review authorId:string --no-interactive
lt server addProp Review rating:number --no-interactive
lt server addProp Review comment:string? --no-interactive
```

**Manual adjustments needed:**
- Add validation for rating (1-5 range)
- Add @Restricted decorator with appropriate roles
- Add GET endpoint to ProductController for reviews
- Add relationship between Product and Review

**Final run - All tests pass:**
```
✅ All tests passing (8 scenarios)
```

---

## Example 2: Complex Business Logic - Order Processing

### Story Requirement

```
As a customer, I want to place an order with multiple products so that I can purchase items together.

Acceptance Criteria:
- Order contains multiple products with quantities
- Order calculates total price automatically
- Order cannot be created with empty product list
- Order requires delivery address
- Order status is initially "pending"
- Products are checked for availability
- Insufficient stock prevents order creation
```

### Step 1: Story Analysis

**Analysis notes:**
- Needs Order module with relationship to Product
- Needs OrderItem subobject for quantity tracking
- Business logic: stock validation
- Calculated field: total price
- Complex validation rules

**Architecture decisions:**
- Use SubObject for OrderItem (embedded in Order)
- Total price should be calculated in service layer
- Stock check happens in service before saving

### Step 2: Create Story Test

**File:** `test/stories/order-processing.story.test.ts`

```typescript
import {
  ConfigService,
  HttpExceptionLogFilter,
  TestGraphQLType,
  TestHelper,
} from '@lenne.tech/nest-server';
import { Test, TestingModule } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';
import { MongoClient, ObjectId } from 'mongodb';

import envConfig from '../../src/config.env';
import { RoleEnum } from '../../src/server/common/enums/role.enum';
import { OrderService } from '../../src/server/modules/order/order.service';
import { ProductService } from '../../src/server/modules/product/product.service';
import { UserService } from '../../src/server/modules/user/user.service';
import { imports, ServerModule } from '../../src/server/server.module';

describe('Order Processing Story', () => {
  // Test environment properties
  let app;
  let testHelper: TestHelper;

  // Database
  let connection;
  let db;

  // Services
  let userService: UserService;
  let productService: ProductService;
  let orderService: OrderService;

  // Global test data
  let gAdminToken: string;
  let gAdminId: string;
  let gCustomerToken: string;
  let gCustomerId: string;
  let gProduct1Id: string;
  let gProduct1Stock: number;
  let gProduct2Id: string;

  // Track created entities for cleanup
  let createdOrderIds: string[] = [];
  let createdProductIds: string[] = [];

  beforeAll(async () => {
    // Start server for testing
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [...imports, ServerModule],
      providers: [
        UserService,
        ProductService,
        OrderService,
        {
          provide: 'PUB_SUB',
          useValue: new PubSub(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionLogFilter());
    app.setBaseViewsDir(envConfig.templates.path);
    app.setViewEngine(envConfig.templates.engine);
    await app.init();

    testHelper = new TestHelper(app);
    userService = moduleFixture.get(UserService);
    productService = moduleFixture.get(ProductService);
    orderService = moduleFixture.get(OrderService);

    // Connection to database
    connection = await MongoClient.connect(envConfig.mongoose.uri);
    db = await connection.db();

    // Create admin user
    const adminPassword = Math.random().toString(36).substring(7);
    const adminEmail = `admin-${adminPassword}@test.com`;
    const adminSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: adminEmail,
          firstName: 'Admin',
          password: adminPassword,
        },
      },
      fields: ['token', { user: ['id', 'email'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gAdminId = adminSignUp.user.id;
    gAdminToken = adminSignUp.token;

    // Set admin role
    await userService.update(gAdminId, { roles: [RoleEnum.ADMIN] }, gAdminId);

    // Create customer user
    const customerPassword = Math.random().toString(36).substring(7);
    const customerEmail = `customer-${customerPassword}@test.com`;
    const customerSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: customerEmail,
          firstName: 'Customer',
          password: customerPassword,
        },
      },
      fields: ['token', { user: ['id'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gCustomerId = customerSignUp.user.id;
    gCustomerToken = customerSignUp.token;

    // Create test products with stock
    const product1 = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: {
        name: 'Product A',
        price: 10.00,
        stock: 100,
      },
      token: gAdminToken,
    });
    gProduct1Id = product1.id;
    gProduct1Stock = product1.stock;

    const product2 = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: {
        name: 'Product B',
        price: 25.50,
        stock: 50,
      },
      token: gAdminToken,
    });
    gProduct2Id = product2.id;

    // Track products for cleanup
    createdProductIds.push(gProduct1Id, gProduct2Id);
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete all test data created during tests
    try {
      // Delete all created orders first (child entities)
      if (createdOrderIds.length > 0) {
        await db.collection('orders').deleteMany({
          _id: { $in: createdOrderIds.map(id => new ObjectId(id)) }
        });
      }

      // Delete all created products
      if (createdProductIds.length > 0) {
        await db.collection('products').deleteMany({
          _id: { $in: createdProductIds.map(id => new ObjectId(id)) }
        });
      }

      // Delete test users
      if (gCustomerId) {
        await db.collection('users').deleteOne({ _id: new ObjectId(gCustomerId) });
      }
      if (gAdminId) {
        await db.collection('users').deleteOne({ _id: new ObjectId(gAdminId) });
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }

    await connection.close();
    await app.close();
  });

  describe('Order Creation - Happy Path', () => {
    it('should create order with multiple products and calculate total', async () => {
      const orderData = {
        items: [
          { productId: gProduct1Id, quantity: 2 },
          { productId: gProduct2Id, quantity: 1 },
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      const order = await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        token: gCustomerToken,
      });

      expect(order).toMatchObject({
        status: 'pending',
        customerId: gCustomerId,
        totalPrice: 45.50, // (10.00 * 2) + (25.50 * 1)
        deliveryAddress: orderData.deliveryAddress,
      });

      expect(order.items).toHaveLength(2);
      expect(order.items[0]).toMatchObject({
        productId: gProduct1Id,
        quantity: 2,
        priceAtOrder: 10.00,
      });

      // Track for cleanup
      createdOrderIds.push(order.id);
    });

    it('should create order with single product', async () => {
      const orderData = {
        items: [
          { productId: gProduct1Id, quantity: 1 },
        ],
        deliveryAddress: {
          street: '456 Oak Ave',
          city: 'Sample Town',
          zipCode: '54321',
          country: 'Germany',
        },
      };

      const order = await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        token: gCustomerToken,
      });

      expect(order.totalPrice).toBe(10.00);

      // Track for cleanup
      createdOrderIds.push(order.id);
    });
  });

  describe('Order Validation', () => {
    it('should reject order with empty product list', async () => {
      const orderData = {
        items: [],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        statusCode: 400,
        token: gCustomerToken,
      });
    });

    it('should reject order without delivery address', async () => {
      const orderData = {
        items: [
          { productId: gProduct1Id, quantity: 1 },
        ],
      };

      await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        statusCode: 400,
        token: gCustomerToken,
      });
    });

    it('should reject order with invalid product ID', async () => {
      const orderData = {
        items: [
          { productId: 'invalid-id', quantity: 1 },
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        statusCode: 404,
        token: gCustomerToken,
      });
    });
  });

  describe('Stock Management', () => {
    it('should reject order when product stock is insufficient', async () => {
      // Create product with limited stock
      const limitedProduct = await testHelper.rest('/api/products', {
        method: 'POST',
        payload: {
          name: 'Limited Product',
          price: 100.00,
          stock: 5,
        },
        token: gAdminToken,
      });

      // Track for cleanup
      createdProductIds.push(limitedProduct.id);

      const orderData = {
        items: [
          { productId: limitedProduct.id, quantity: 10 }, // More than available
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      const response = await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        statusCode: 400,
        token: gCustomerToken,
      });

      expect(response.message).toContain('insufficient stock');
    });

    it('should reduce product stock after successful order', async () => {
      const initialStock = gProduct1Stock;

      const orderData = {
        items: [
          { productId: gProduct1Id, quantity: 3 },
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      const order = await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        token: gCustomerToken,
      });

      // Track for cleanup
      createdOrderIds.push(order.id);

      // Check product stock was reduced
      const updatedProduct = await testHelper.rest(`/api/products/${gProduct1Id}`, {
        token: gAdminToken,
      });

      expect(updatedProduct.stock).toBe(initialStock - 3);

      // Update global stock for subsequent tests
      gProduct1Stock = updatedProduct.stock;
    });
  });

  describe('Authorization', () => {
    it('should reject unauthenticated order creation', async () => {
      const orderData = {
        items: [
          { productId: gProduct1Id, quantity: 1 },
        ],
        deliveryAddress: {
          street: '123 Main St',
          city: 'Test City',
          zipCode: '12345',
          country: 'Germany',
        },
      };

      await testHelper.rest('/api/orders', {
        method: 'POST',
        payload: orderData,
        statusCode: 401,
      });
    });
  });
});
```

### Implementation Steps

**SubObject creation:**
```typescript
// Create OrderItem SubObject manually
// File: src/server/modules/order/order-item.subobject.ts

@SubObjectType()
export class OrderItem {
  @UnifiedField({
    description: 'Reference to product',
    mongoose: { index: true, type: String }  // ✅ Index for queries by product
  })
  productId: string;

  @UnifiedField({
    description: 'Quantity ordered',
    mongoose: { type: Number }
  })
  quantity: number;

  @UnifiedField({
    description: 'Price when order was placed',
    mongoose: { type: Number }
  })
  priceAtOrder: number;
}
```

**Model with indexes:**
```typescript
// File: src/server/modules/order/order.model.ts

@Schema()
export class Order {
  @UnifiedField({
    description: 'Customer who placed the order',
    mongoose: { index: true, type: String }  // ✅ Frequent queries by customer
  })
  customerId: string;

  @UnifiedField({
    description: 'Order status',
    mongoose: { index: true, type: String }  // ✅ Filtering by status
  })
  status: string;

  @UnifiedField({
    description: 'Order items',
    mongoose: { type: [OrderItem] }
  })
  items: OrderItem[];

  @UnifiedField({
    description: 'Total price calculated from items',
    mongoose: { type: Number }
  })
  totalPrice: number;

  @UnifiedField({
    description: 'Delivery address',
    mongoose: { type: Object }
  })
  deliveryAddress: Address;
}
```

**Why these indexes?**
- `customerId`: Service queries orders by customer → needs index
- `status`: Service filters by status (pending, completed) → needs index
- Both indexed individually for flexible querying

**Service logic for total calculation and stock validation:**
```typescript
// In OrderService (extends CrudService)

async create(input: CreateOrderInput, userId: string): Promise<Order> {
  // Validate items exist
  if (!input.items || input.items.length === 0) {
    throw new BadRequestException('Order must contain at least one item');
  }

  // Check stock and calculate total
  let totalPrice = 0;
  const orderItems = [];

  for (const item of input.items) {
    const product = await this.productService.findById(item.productId);
    if (!product) {
      throw new NotFoundException(`Product ${item.productId} not found`);
    }

    if (product.stock < item.quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${product.name}`
      );
    }

    orderItems.push({
      productId: product.id,
      quantity: item.quantity,
      priceAtOrder: product.price,
    });

    totalPrice += product.price * item.quantity;
  }

  // Create order
  const order = await super.create({
    ...input,
    items: orderItems,
    totalPrice,
    customerId: userId,
    status: 'pending',
  });

  // Reduce stock
  for (const item of input.items) {
    await this.productService.reduceStock(item.productId, item.quantity);
  }

  return order;
}
```

---

## Example 3: GraphQL Mutation - User Profile Update

### Story Requirement

```
As a user, I want to update my profile information so that my account reflects current details.

Acceptance Criteria:
- Users can update their firstName, lastName, phone
- Users cannot change their email through this endpoint
- Users can only update their own profile
- Admin users can update any profile
- Phone number must be validated (German format)
```

### Step 2: Create Story Test (GraphQL)

**File:** `test/stories/profile-update.story.test.ts`

```typescript
import {
  ConfigService,
  HttpExceptionLogFilter,
  TestGraphQLType,
  TestHelper,
} from '@lenne.tech/nest-server';
import { Test, TestingModule } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';
import { MongoClient } from 'mongodb';

import envConfig from '../../src/config.env';
import { RoleEnum } from '../../src/server/common/enums/role.enum';
import { UserService } from '../../src/server/modules/user/user.service';
import { imports, ServerModule } from '../../src/server/server.module';

describe('Profile Update Story (GraphQL)', () => {
  // Test environment properties
  let app;
  let testHelper: TestHelper;

  // Database
  let connection;
  let db;

  // Services
  let userService: UserService;

  // Global test data
  let gNormalUserId: string;
  let gNormalUserToken: string;
  let gNormalUserEmail: string;
  let gOtherUserId: string;
  let gOtherUserToken: string;
  let gAdminUserId: string;
  let gAdminUserToken: string;

  // Track created entities for cleanup
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    // Start server for testing
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [...imports, ServerModule],
      providers: [
        UserService,
        {
          provide: 'PUB_SUB',
          useValue: new PubSub(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionLogFilter());
    app.setBaseViewsDir(envConfig.templates.path);
    app.setViewEngine(envConfig.templates.engine);
    await app.init();

    testHelper = new TestHelper(app);
    userService = moduleFixture.get(UserService);

    // Connection to database
    connection = await MongoClient.connect(envConfig.mongoose.uri);
    db = await connection.db();

    // Create normal user
    const normalPassword = Math.random().toString(36).substring(7);
    gNormalUserEmail = `user-${normalPassword}@test.com`;
    const normalSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: gNormalUserEmail,
          firstName: 'John',
          lastName: 'Doe',
          password: normalPassword,
        },
      },
      fields: ['token', { user: ['id', 'email'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gNormalUserId = normalSignUp.user.id;
    gNormalUserToken = normalSignUp.token;

    // Track for cleanup
    createdUserIds.push(gNormalUserId);

    // Create other user
    const otherPassword = Math.random().toString(36).substring(7);
    const otherEmail = `other-${otherPassword}@test.com`;
    const otherSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: otherEmail,
          firstName: 'Other',
          password: otherPassword,
        },
      },
      fields: ['token', { user: ['id'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gOtherUserId = otherSignUp.user.id;
    gOtherUserToken = otherSignUp.token;

    // Track for cleanup
    createdUserIds.push(gOtherUserId);

    // Create admin user
    const adminPassword = Math.random().toString(36).substring(7);
    const adminEmail = `admin-${adminPassword}@test.com`;
    const adminSignUp = await testHelper.graphQl({
      arguments: {
        input: {
          email: adminEmail,
          firstName: 'Admin',
          password: adminPassword,
        },
      },
      fields: ['token', { user: ['id'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gAdminUserId = adminSignUp.user.id;
    gAdminUserToken = adminSignUp.token;

    // Track for cleanup
    createdUserIds.push(gAdminUserId);

    // Set admin role
    await userService.update(gAdminUserId, { roles: [RoleEnum.ADMIN] }, gAdminUserId);
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete all test data created during tests
    try {
      // Delete all created users
      if (createdUserIds.length > 0) {
        await db.collection('users').deleteMany({
          _id: { $in: createdUserIds.map(id => new ObjectId(id)) }
        });
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }

    await connection.close();
    await app.close();
  });

  describe('Own Profile Update', () => {
    it('should allow user to update own profile', async () => {
      const result = await testHelper.graphQl({
        arguments: {
          id: gNormalUserId,
          input: {
            firstName: 'Jane',
            lastName: 'Smith',
            phone: '+49 123 456789',
          },
        },
        fields: ['id', 'firstName', 'lastName', 'phone', 'email'],
        name: 'updateUser',
        type: TestGraphQLType.MUTATION,
      }, { token: gNormalUserToken });

      expect(result).toMatchObject({
        id: gNormalUserId,
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+49 123 456789',
        email: gNormalUserEmail, // Email unchanged
      });
    });

    it('should prevent user from changing email', async () => {
      const result = await testHelper.graphQl({
        arguments: {
          id: gNormalUserId,
          input: {
            firstName: 'John',
            email: 'newemail@test.com', // Attempt to change email
          },
        },
        fields: ['email'],
        name: 'updateUser',
        type: TestGraphQLType.MUTATION,
      }, { token: gNormalUserToken });

      // Email should remain unchanged
      expect(result.email).toBe(gNormalUserEmail);
    });
  });

  describe('Authorization', () => {
    it('should prevent user from updating other user profile', async () => {
      const result = await testHelper.graphQl({
        arguments: {
          id: gOtherUserId,
          input: {
            firstName: 'Hacker',
          },
        },
        fields: ['id', 'firstName'],
        name: 'updateUser',
        type: TestGraphQLType.MUTATION,
      }, { token: gNormalUserToken, statusCode: 200 });

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Forbidden');
    });

    it('should allow admin to update any profile', async () => {
      const result = await testHelper.graphQl({
        arguments: {
          id: gNormalUserId,
          input: {
            firstName: 'AdminUpdated',
          },
        },
        fields: ['firstName'],
        name: 'updateUser',
        type: TestGraphQLType.MUTATION,
      }, { token: gAdminUserToken });

      expect(result.firstName).toBe('AdminUpdated');
    });
  });

  describe('Validation', () => {
    it('should reject invalid phone number format', async () => {
      const result = await testHelper.graphQl({
        arguments: {
          id: gNormalUserId,
          input: {
            phone: '123', // Invalid format
          },
        },
        fields: ['phone'],
        name: 'updateUser',
        type: TestGraphQLType.MUTATION,
      }, { token: gNormalUserToken, statusCode: 200 });

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('phone');
    });

    it('should accept valid German phone formats', async () => {
      const validPhones = [
        '+49 123 456789',
        '+49 (0)123 456789',
        '0123 456789',
      ];

      for (const phone of validPhones) {
        const result = await testHelper.graphQl({
          arguments: {
            id: gNormalUserId,
            input: { phone },
          },
          fields: ['phone'],
          name: 'updateUser',
          type: TestGraphQLType.MUTATION,
        }, { token: gNormalUserToken });

        expect(result.phone).toBe(phone);
      }
    });
  });
});
```

---

## Debugging Test Failures

When your tests fail and error messages are unclear, enable debugging:

### TestHelper Debugging Options

```typescript
// Add to any failing test for detailed output
const result = await testHelper.graphQl({
  arguments: { id: userId },
  fields: ['id', 'email'],
  name: 'getUser',
  type: TestGraphQLType.MUTATION,
}, {
  token: userToken,
  log: true,        // Logs request details to console
  logError: true,   // Logs detailed error information
});

// Or for REST calls
const result = await testHelper.rest('/api/endpoint', {
  method: 'POST',
  payload: data,
  token: userToken,
  log: true,
  logError: true,
});
```

### Server-Side Debugging

**Enable exception logging** in `src/config.env.ts`:
```typescript
export default {
  logExceptions: true,  // Shows stack traces for all exceptions
  // ... other config
};
```

**Enable validation debugging** via environment variable:
```bash
# Run tests with validation debugging
DEBUG_VALIDATION=true npm test
```

Or set in your test file:
```typescript
beforeAll(async () => {
  // Enable validation debug logging
  process.env.DEBUG_VALIDATION = 'true';

  // ... rest of setup
});
```

This enables detailed console.debug output from MapAndValidatePipe (`node_modules/@lenne.tech/nest-server/src/core/common/pipes/map-and-validate.pipe.ts`).

### Full Debugging Setup Example

```typescript
describe('My Story Test', () => {
  beforeAll(async () => {
    // Enable validation debugging
    process.env.DEBUG_VALIDATION = 'true';

    // ... normal setup
  });

  it('should debug this failing test', async () => {
    const result = await testHelper.graphQl({
      // ... your test config
    }, {
      log: true,        // Enable request/response logging
      logError: true,   // Enable error logging
    });
  });
});
```

**Remember to disable debugging logs before committing** to keep test output clean in CI/CD.

---

## Key Takeaways from Examples

### 1. Test Structure
- Always setup test data in `beforeAll`
- Clean up in `afterAll`
- Group related tests in `describe` blocks
- Test happy path, validation, authorization separately

### 2. Security Testing
- Create users with different roles
- Test both authorized and unauthorized access
- Never weaken security to make tests pass
- Test permission boundaries explicitly

### 3. Business Logic
- Test calculated fields (like totalPrice)
- Test side effects (like stock reduction)
- Test validation rules thoroughly
- Test edge cases and error conditions

### 4. Implementation Strategy
- Use nest-server-generator for scaffolding
- Implement business logic in services
- Add custom validation where needed
- Follow existing patterns in codebase

### 5. Debugging
- Use `log: true` and `logError: true` in TestHelper for detailed output
- Enable `logExceptions` in config.env.ts for server-side errors
- Use `DEBUG_VALIDATION=true` for validation debugging
- Disable the debug logs again once all tests have been completed without errors

### 6. Iteration
- First run will always fail (expected)
- Fix failures systematically
- Enable debugging when error messages are unclear
- Re-run tests after each change
- Continue until all tests pass

Remember: **Tests define the contract, code fulfills the contract.**