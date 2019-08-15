import { CoreUserCreateInput } from '@lenne.tech/nest-server';
import { InputType } from 'type-graphql';

/**
 * User input to create a new user
 */
@InputType({ description: 'User input to create a new user' })
export class UserCreateInput extends CoreUserCreateInput {
  // Extend UserCreateInput here
}
