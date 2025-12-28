// 修复User、ApiKey和Credential表的自增序列
const { PrismaClient } = require('@prisma/client');

async function fixSequence() {
  console.log('=== 修复数据库自增序列 ===');
  
  try {
    const prisma = new PrismaClient();
    await prisma.$connect();
    
    // 修复User表序列
    console.log('\n--- 修复User表序列 ---');
    // 检查user表的最大id值
    console.log('1. 检查User表的最大id值');
    const maxUserId = await prisma.$queryRaw`
      SELECT MAX(id) as max_id FROM "User"
    `;
    console.log('   最大id值:', maxUserId[0].max_id);
    
    // 重置序列值
    if (maxUserId[0].max_id) {
      const newUserSequenceValue = maxUserId[0].max_id + 1;
      console.log('2. 重置User序列值为:', newUserSequenceValue);
      
      // 执行序列重置
      await prisma.$executeRawUnsafe(
        `ALTER SEQUENCE "User_id_seq" RESTART WITH ${newUserSequenceValue}`
      );
      
      console.log('   ✅ User序列重置成功');
    }
    
    // 修复ApiKey表序列
    console.log('\n--- 修复ApiKey表序列 ---');
    // 检查ApiKey表的最大id值
    console.log('1. 检查ApiKey表的最大id值');
    const maxApiKeyId = await prisma.$queryRaw`
      SELECT MAX(id) as max_id FROM "ApiKey"
    `;
    console.log('   最大id值:', maxApiKeyId[0].max_id);
    
    // 重置序列值
    if (maxApiKeyId[0].max_id) {
      const newApiKeySequenceValue = maxApiKeyId[0].max_id + 1;
      console.log('2. 重置ApiKey序列值为:', newApiKeySequenceValue);
      
      // 执行序列重置
      await prisma.$executeRawUnsafe(
        `ALTER SEQUENCE "ApiKey_id_seq" RESTART WITH ${newApiKeySequenceValue}`
      );
      
      console.log('   ✅ ApiKey序列重置成功');
    }
    
    await prisma.$disconnect();
    console.log('\n✅ 所有序列修复完成！');
  } catch (error) {
    console.error('❌ 序列修复失败:', error.message);
    console.error('详细错误:', error);
  }
}

fixSequence();
