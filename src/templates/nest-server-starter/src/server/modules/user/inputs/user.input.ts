import { CoreUserInput } from '@lenne.tech/nest-server';
import { InputType } from 'type-graphql';

/**
 * User input to update a user
 */
@InputType({ description: 'User input' })
export class UserInput extends CoreUserInput {
  // Extend UserInput here
}
