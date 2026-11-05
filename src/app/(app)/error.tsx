'use client';

import { useEffect } from 'react';
import { ErrorPage } from '@/components/ui';

// Next keeps server error messages out of production responses; the digest ties this view to the log line.
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => console.error(error), [error]);
  return <ErrorPage message={error.digest ? `Penny hit an error loading this page (ref ${error.digest}).` : error.message} />;
}
