import React from 'react';
export default function Home() { return <main>{React.version}</main>; }
export const getStaticProps = async () => ({ props: {} });
