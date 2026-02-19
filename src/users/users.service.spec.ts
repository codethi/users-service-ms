import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { UserStatus } from './enums/user-status.enum';

describe('UsersService', () => {
  let usersService: UsersService;
  let usersRepository: jest.Mocked<Partial<Repository<User>>>;

  const mockUser: User = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'test@example.com',
    password: '$2a$10$hashedpassword',
    firstName: 'João',
    lastName: 'Silva',
    role: UserRole.BUYER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSeller: User = {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    email: 'seller@example.com',
    password: '$2a$10$hashedpassword',
    firstName: 'Vendedor',
    lastName: 'Um',
    role: UserRole.SELLER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    usersRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepository },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
  });

  describe('findById', () => {
    it('should return a user when found by id', async () => {
      usersRepository.findOne.mockResolvedValue(mockUser);

      const result = await usersService.findById(mockUser.id);

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user is not found', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      const result = await usersService.findById('non-existent-id');

      expect(usersRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
      expect(result).toBeNull();
    });
  });

  describe('findActiveSellers', () => {
    it('should return only active sellers', async () => {
      usersRepository.find.mockResolvedValue([mockSeller]);

      const result = await usersService.findActiveSellers();

      expect(usersRepository.find).toHaveBeenCalledWith({
        where: { role: UserRole.SELLER, status: UserStatus.ACTIVE },
      });
      expect(result).toEqual([mockSeller]);
    });

    it('should return an empty array when there are no active sellers', async () => {
      usersRepository.find.mockResolvedValue([]);

      const result = await usersService.findActiveSellers();

      expect(usersRepository.find).toHaveBeenCalledWith({
        where: { role: UserRole.SELLER, status: UserStatus.ACTIVE },
      });
      expect(result).toEqual([]);
    });
  });
});
