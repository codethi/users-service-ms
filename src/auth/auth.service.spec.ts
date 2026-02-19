import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';
import { User } from '../users/entities/user.entity';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;

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
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$10$hashedpassword');
      usersService.create.mockResolvedValue(mockUser);

      const result = await authService.register(registerDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(usersService.create).toHaveBeenCalledWith({
        ...registerDto,
        password: '$2a$10$hashedpassword',
        status: UserStatus.ACTIVE,
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictException when email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(authService.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(authService.register(registerDto)).rejects.toThrow(
        'Email already registered',
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should hash the password with 10 salt rounds', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2a$10$hashedpassword');
      usersService.create.mockResolvedValue(mockUser);

      await authService.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });
  });
});
