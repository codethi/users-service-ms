import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';
import { User } from './entities/user.entity';

describe('UsersController', () => {
  let usersController: UsersController;
  let usersService: jest.Mocked<Partial<UsersService>>;

  const mockUser: User = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'buyer@example.com',
    password: '$2a$10$hashedpassword',
    firstName: 'João',
    lastName: 'Silva',
    role: UserRole.BUYER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSeller1: User = {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    email: 'seller1@example.com',
    password: '$2a$10$hashedpassword',
    firstName: 'Vendedor',
    lastName: 'Um',
    role: UserRole.SELLER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSeller2: User = {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    email: 'seller2@example.com',
    password: '$2a$10$hashedpassword',
    firstName: 'Vendedor',
    lastName: 'Dois',
    role: UserRole.SELLER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      findById: jest.fn(),
      findActiveSellers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    usersController = module.get<UsersController>(UsersController);
  });

  describe('getProfile', () => {
    it('should return the authenticated user data', async () => {
      const req = {
        user: { id: mockUser.id, email: mockUser.email, role: mockUser.role },
      };
      usersService.findById.mockResolvedValue(mockUser);

      const result = await usersController.getProfile(req);

      expect(usersService.findById).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockUser);
    });
  });

  describe('getActiveSellers', () => {
    it('should return an array of active sellers', async () => {
      usersService.findActiveSellers.mockResolvedValue([
        mockSeller1,
        mockSeller2,
      ]);

      const result = await usersController.getActiveSellers();

      expect(usersService.findActiveSellers).toHaveBeenCalled();
      expect(result).toEqual([mockSeller1, mockSeller2]);
    });

    it('should return an empty array when there are no active sellers', async () => {
      usersService.findActiveSellers.mockResolvedValue([]);

      const result = await usersController.getActiveSellers();

      expect(usersService.findActiveSellers).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return a user when found', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      const result = await usersController.findById(mockUser.id);

      expect(usersService.findById).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user is not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        usersController.findById('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        usersController.findById('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      ).rejects.toThrow('User not found');
    });
  });
});
