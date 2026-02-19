import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    healthController = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('should return status ok and service name', () => {
      const result = healthController.check();

      expect(result).toEqual({
        status: 'ok',
        service: 'users-service',
      });
    });

    it('should return an object with exactly status and service properties', () => {
      const result = healthController.check();

      expect(Object.keys(result)).toHaveLength(2);
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('service');
    });
  });
});
