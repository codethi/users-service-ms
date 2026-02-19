import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';

interface JwtUserPayload {
  id: string;
  email: string;
  role: string;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@Request() req: { user: JwtUserPayload }) {
    return this.usersService.findById(req.user.id);
  }

  @Get('sellers')
  async getActiveSellers() {
    return this.usersService.findActiveSellers();
  }

  @Get(':id')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    const user = await this.usersService.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
