import { AuthService } from './auth.service';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    login(body: any): Promise<{
        access_token: string;
        user: {
            email: any;
            role: any;
            lastLoginAt: any;
        };
    }>;
}
