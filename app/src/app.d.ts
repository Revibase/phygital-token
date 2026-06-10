declare global {
	namespace App {
		interface Platform {
			env?: Record<string, string>;
		}
	}
}

export {};
