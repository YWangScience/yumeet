import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>页面不存在</h1>
      <p className={styles.body}>
        你访问的活动可能尚未发布、已被归档,或链接有误。
      </p>
      <Link className={styles.button} href="/">返回首页</Link>
    </main>
  );
}
