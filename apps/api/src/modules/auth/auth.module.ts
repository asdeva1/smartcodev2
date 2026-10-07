import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccountService],
  exports: [AuthService, AccountService],
})
export class AuthApiModule {}
