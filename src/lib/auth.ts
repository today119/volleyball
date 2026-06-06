/**
 * Google 로그인 게이트.
 *
 * 보안 모델:
 *   - 읽기(share/보기): 로그인 불필요.
 *   - 쓰기(기록): 구글 로그인 + 학교 도메인(@yeongjong.icehs.kr) 사용자만.
 *
 * RTDB 규칙과 반드시 짝을 맞춘다:
 *   ".read": true,
 *   ".write": "auth != null && auth.token.email.endsWith('@yeongjong.icehs.kr')"
 */
import { useEffect, useState } from 'react';
import firebase, { auth } from './firebase';

export const ALLOWED_DOMAIN = '@yeongjong.icehs.kr';

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

/** 이메일이 허용 학교 도메인인지 (대소문자 무시, 정확히 끝자리 검증). */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_DOMAIN);
}

/** 기록(쓰기) 권한: 학교 도메인 + 이메일 인증됨 (RTDB 규칙과 동일 조건). */
export function canWrite(user: AuthUser | null): boolean {
  return !!user && isAllowedEmail(user.email) && user.emailVerified;
}

function toAuthUser(u: firebase.User | null): AuthUser | null {
  if (!u) return null;
  return { uid: u.uid, email: u.email, name: u.displayName, photoURL: u.photoURL, emailVerified: u.emailVerified };
}

/**
 * 구글 로그인 팝업. 학교 도메인이 아니면 로그아웃시키고 거부.
 * @returns 로그인된 AuthUser (성공·허용) — 실패/거부 시 throw.
 */
export async function signInWithGoogle(): Promise<AuthUser> {
  const provider = new firebase.auth.GoogleAuthProvider();
  // 학교 계정으로 빠르게 고르도록 힌트 (강제는 규칙에서)
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN.replace('@', '') });
  const cred = await auth.signInWithPopup(provider);
  const user = toAuthUser(cred.user);
  if (!isAllowedEmail(user?.email)) {
    await auth.signOut();
    throw new Error(`학교 계정(${ALLOWED_DOMAIN})으로만 기록할 수 있습니다. (시도: ${user?.email ?? '알 수 없음'})`);
  }
  return user!;
}

export async function signOut(): Promise<void> {
  await auth.signOut();
}

/** 인증 상태 구독 훅. { user, ready, allowed } */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(toAuthUser(u));
      setReady(true);
    });
    return () => unsub();
  }, []);

  return { user, ready, allowed: canWrite(user) };
}
