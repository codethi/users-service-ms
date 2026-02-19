import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { UserStatus } from '../users/enums/user-status.enum';
import { User } from '../users/entities/user.entity';

jest.mock('bcryptjs');

const mockHash = hash as jest.MockedFunction<typeof hash>;
const mockCompare = compare as jest.MockedFunction<typeof compare>;

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;

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
      findByEmailWithPassword: jest.fn(),
      create: jest.fn(),
    };

    jwtService = {
      sign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
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
      mockHash.mockResolvedValue('$2a$10$hashedpassword' as never);
      usersService.create.mockResolvedValue(mockUser);

      const result = await authService.register(registerDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(mockHash).toHaveBeenCalledWith(registerDto.password, 10);
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
      mockHash.mockResolvedValue('$2a$10$hashedpassword' as never);
      usersService.create.mockResolvedValue(mockUser);

      await authService.register(registerDto);

      expect(mockHash).toHaveBeenCalledWith('password123', 10);
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login successfully and return user with token', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(mockUser);
      mockCompare.mockResolvedValue(true as never);
      jwtService.sign.mockReturnValue('jwt-token-123');

      const result = await authService.login(loginDto);

      expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(
        loginDto.email,
      );
      expect(mockCompare).toHaveBeenCalledWith(
        loginDto.password,
        mockUser.password,
      );
      expect(result).toEqual({ user: mockUser, token: 'jwt-token-123' });
    });

    it('should generate JWT with correct payload (sub, email, role)', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(mockUser);
      mockCompare.mockResolvedValue(true as never);
      jwtService.sign.mockReturnValue('jwt-token-123');

      await authService.login(loginDto);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
    });

    it('should throw UnauthorizedException when email is not found', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(loginDto)).rejects.toThrow(
        'Credenciais inválidas',
      );
      expect(mockCompare).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(mockUser);
      mockCompare.mockResolvedValue(false as never);

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(loginDto)).rejects.toThrow(
        'Credenciais inválidas',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when account is inactive', async () => {
      const inactiveUser: User = {
        ...mockUser,
        status: UserStatus.INACTIVE,
      };
      usersService.findByEmailWithPassword.mockResolvedValue(inactiveUser);
      mockCompare.mockResolvedValue(true as never);

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(authService.login(loginDto)).rejects.toThrow(
        'Conta inativa',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
