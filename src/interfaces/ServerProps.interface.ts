/**
 * Server properties for models and inputs
 */
export interface ServerProps {
  name: string;
  isArray: boolean;
  nullable: boolean;
  reference: string;
  enumRef: string;
  schema: string;
  type: string;
}
