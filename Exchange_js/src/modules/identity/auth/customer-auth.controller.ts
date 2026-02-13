import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  customerType: z.enum(['INDIVIDUAL', 'CORPORATE']),
  companyName: z.string().trim().min(1).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.customerType === 'CORPORATE' && !val.companyName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['companyName'],
      message: 'companyName is required for corporate customer',
    });
  }
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

@ApiTags('auth-customer')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private customerAuthService: CustomerAuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new customer' })
  async register(@Body() body: any) {
    const result = RegisterSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid input format');
    }
    return this.customerAuthService.register(result.data);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login for customer' })
  @ApiResponse({ status: 200, description: 'Return JWT token' })
  async login(@Body() body: any) {
    const result = LoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid input format');
    }

    const customer = await this.customerAuthService.validateCustomer(
      body.email,
      body.password,
    );
    if (!customer) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.customerAuthService.login(customer);
  }
}
