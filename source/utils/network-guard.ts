/**
 * Outbound-request guard for model-driven fetches (`fetch_url`).
 *
 * The model chooses the URL, so a prompt-injected page can aim it at the
 * cloud metadata endpoint, a router admin page, or any service bound to
 * localhost. Checking the hostname string is not enough: a public name can
 * resolve to a private address, and a public URL can redirect to one. So the
 * check runs on the resolved address, inside the socket's DNS lookup, for
 * every connection including each redirect hop.
 */

import {lookup as dnsLookup, type LookupAddress} from 'node:dns';
import {BlockList, isIP, type LookupFunction} from 'node:net';
import {Agent} from 'undici';

const blocked = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8], // "this" network
	['10.0.0.0', 8],
	['127.0.0.0', 8],
	['169.254.0.0', 16], // link-local, cloud metadata
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 4], // multicast
	['240.0.0.0', 4], // reserved, broadcast
] as const) {
	blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['fc00::', 7], // unique local
	['fe80::', 10], // link-local
	['ff00::', 8], // multicast
] as const) {
	blocked.addSubnet(network, prefix, 'ipv6');
}

/** IPv4 embedded in an IPv4-mapped IPv6 address, in either spelling. */
function mappedIPv4(address: string): string | null {
	const lower = address.toLowerCase();
	if (!lower.startsWith('::ffff:')) return null;
	const tail = lower.slice('::ffff:'.length);
	if (isIP(tail) === 4) return tail;
	const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
	if (!hex) return null;
	const high = Number.parseInt(hex[1], 16);
	const low = Number.parseInt(hex[2], 16);
	return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Whether `address` (an IP literal) is loopback, private, or otherwise internal. */
export function isPrivateAddress(address: string): boolean {
	const bare = address.replace(/^\[|\]$/g, '');
	const mapped = mappedIPv4(bare);
	if (mapped) return blocked.check(mapped, 'ipv4');
	const family = isIP(bare);
	if (family === 4) return blocked.check(bare, 'ipv4');
	if (family === 6) return blocked.check(bare, 'ipv6');
	return false;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
	dnsLookup(hostname, {...options, all: true}, (error, addresses) => {
		if (error) {
			callback(error, '', 0);
			return;
		}
		const list = addresses as LookupAddress[];
		const internal = list.find(entry => isPrivateAddress(entry.address));
		if (internal || list.length === 0) {
			callback(
				new Error(
					`Refusing to connect to internal address ${internal?.address ?? 'none'} for ${hostname}`,
				),
				'',
				0,
			);
			return;
		}
		if (options.all) {
			(callback as unknown as (err: null, all: LookupAddress[]) => void)(
				null,
				list,
			);
		} else {
			callback(null, list[0].address, list[0].family);
		}
	});
};

/** undici dispatcher whose every connection refuses internal addresses. */
export const publicOnlyAgent = new Agent({connect: {lookup: guardedLookup}});

/**
 * Reject URLs that can't be fetched safely before any connection is made:
 * non-http(s) schemes and IP-literal hosts in internal ranges (a literal never
 * reaches the DNS lookup above).
 */
export function assertPublicHttpUrl(url: URL): void {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(
			`Invalid URL protocol "${url.protocol}". Only http: and https: are supported.`,
		);
	}
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		isPrivateAddress(host)
	) {
		throw new Error(
			`Cannot fetch from internal/private network address: ${url.hostname}`,
		);
	}
}
