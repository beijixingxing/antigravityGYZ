// 修复Credential表自增序列
const { PrismaClient } = require('@prisma/client');

async function fixCredentialSequence() {
  console.log('=== 修复Credential表自增序列 ===');
  
  try {
    const prisma = new PrismaClient();
    await prisma.$connect();
    
    // 检查Credential表的最大id值
    console.log('1. 检查Credential表的最大id值');
    const maxId = await prisma.$queryRaw`SELECT MAX(id) as max_id FROM "Credential"`;
    console.log('   最大id值:', maxId[0].max_id);
    
    // 重置序列值
    if (maxId[0].max_id) {
      const newSequenceValue = maxId[0].max_id + 1;
      console.log('2. 重置序列值为:', newSequenceValue);
      
      // 执行序列重置
      await prisma.$executeRawUnsafe(`ALTER SEQUENCE "Credential_id_seq" RESTART WITH ${newSequenceValue}`);
      
      console.log('   ✅ Credential序列重置成功');
    }
    
    await prisma.$disconnect();
    console.log('\n✅ 序列修复完成！');
  } catch (error) {
    console.error('❌ 序列修复失败:', error.message);
    console.error('详细错误:', error);
  }
}

fixCredentialSequence();