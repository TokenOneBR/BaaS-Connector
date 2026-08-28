import { Body, Controller, Post } from '@nestjs/common';

import { TokenService } from './auth.guard.js';

/** OAuth2 client_credentials, com o corpo form-encoded que a Celcoin usa. */
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly tokens: TokenService) {}

  @Post('token')
  token(
    @Body()
    body: {
      grant_type?: string;
      client_id: string;
      client_secret: string;
    },
  ) {
    const issued = this.tokens.issue(body.client_id, body.client_secret);
    return {
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
    };
  }
}
