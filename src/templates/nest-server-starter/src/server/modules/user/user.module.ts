import { ConfigService, EmailService, JSON, TemplateService } from '@lenne.tech/nest-server';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import envConfig from '../../../config.env';
import { AvatarController } from './avatar.controller';
import { User } from './user.model';
import { UserResolver } from './user.resolver';
import { UserService } from './user.service';

/**
 * User module
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AvatarController],
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService(envConfig),
    },

    // Standard services
    EmailService, TemplateService, JSON, UserResolver, UserService,
  ],
  exports: [ConfigService, EmailService, TemplateService, JSON, TypeOrmModule, UserResolver, UserService],
})
export class UserModule {
}
