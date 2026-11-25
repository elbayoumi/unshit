import React from 'react';
export const metadata = { title: 'x' };
export default function Layout({ children }: { children: unknown }) { return <div>{React.version}{children}</div>; }
