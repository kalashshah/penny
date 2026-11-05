import { getAuth } from '@/auth';
import { getEnv } from '@/context';

// better-auth owns /api/auth/*: email codes, Google, sessions.
const handle = (req: Request) => getAuth(getEnv()).handler(req);
export { handle as GET, handle as POST };
