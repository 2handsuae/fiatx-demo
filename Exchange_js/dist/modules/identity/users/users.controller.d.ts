import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    findAll(skip?: string, take?: string): Promise<{
        id: string;
        userNo: string;
        email: string;
        password: string;
        role: string;
        status: string;
        failedLoginAttempts: number;
        lockedUntil: Date | null;
        lastLoginAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
}
