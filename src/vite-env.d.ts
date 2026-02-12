// Fixed error by removing missing vite/client reference.
// Declaring process to support process.env.API_KEY usage.
declare global {
  var process: {
    env: {
      API_KEY: string;
      [key: string]: any;
    }
  };
}

export {};
