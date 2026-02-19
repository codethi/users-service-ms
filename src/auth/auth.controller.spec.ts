import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';
import { User } from '../users/entities/user.entity';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;

  const registerDto: RegisterDto = {
    email: 'test@example.com',
    password: 'password123',
    firstName: 'João',
    lastName: 'Silva',
    role: UserRole.BUYER,
  };

  const mockUser: User = {
    id: 'uuid-123',
    email: registerDto.email,
    password: '$2a$10$hashedpassword',
    firstName: registerDto.firstName,
    lastName: registerDto.lastName,
    role: UserRole.BUYER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    authController = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should call authService.register with the correct DTO and return the result', async () => {
      authService.register.mockResolvedValue(mockUser);

      const result = await authController.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(mockUser);
    });
  });

  describe('validateToken', () => {
    it('should return userId, email and role from the authenticated user', () => {
      const mockRequest = {
        user: {
          id: 'uuid-123',
          email: 'test@example.com',
          role: 'buyer',
        },
      } as unknown as import('express').Request;

      const result = authController.validateToken(mockRequest);

      expect(result).toEqual({
        userId: 'uuid-123',
        email: 'test@example.com',
        role: 'buyer',
      });
    });

    it('should map id to userId correctly', () => {
      const mockRequest = {
        user: {
          id: 'another-uuid-456',
          email: 'other@example.com',
          role: 'seller',
        },
      } as unknown as import('express').Request;

      const result = authController.validateToken(mockRequest);

      expect(result.userId).toBe('another-uuid-456');
      expect(result).not.toHaveProperty('id');
    });
  });
});
