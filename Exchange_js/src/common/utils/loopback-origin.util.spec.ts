import { expandLoopbackOrigins } from './loopback-origin.util';

describe('expandLoopbackOrigins', () => {
  it('should expand localhost origin to common loopback aliases', () => {
    expect(expandLoopbackOrigins(['http://localhost:3501'])).toEqual([
      'http://localhost:3501',
      'http://127.0.0.1:3501',
      'http://[::1]:3501',
    ]);
  });

  it('should expand ipv4 loopback origin to localhost and ipv6 aliases', () => {
    expect(expandLoopbackOrigins(['http://127.0.0.1:3502'])).toEqual([
      'http://127.0.0.1:3502',
      'http://localhost:3502',
      'http://[::1]:3502',
    ]);
  });

  it('should keep non-loopback origins unchanged', () => {
    expect(expandLoopbackOrigins(['https://admin.example.com'])).toEqual([
      'https://admin.example.com',
    ]);
  });

  it('should de-duplicate overlapping loopback origins', () => {
    expect(
      expandLoopbackOrigins([
        'http://localhost:3501',
        'http://127.0.0.1:3501',
      ]),
    ).toEqual([
      'http://localhost:3501',
      'http://127.0.0.1:3501',
      'http://[::1]:3501',
    ]);
  });
});

