import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  }
})

const list = await client.send(new ListObjectsV2Command({
  Bucket: 'filarr-sync'
}))

for (const obj of list.Contents || []) {
  await client.send(new DeleteObjectCommand({
    Bucket: 'filarr-sync',
    Key: obj.Key
  }))
  console.log('Deleted:', obj.Key)
}

console.log('Done')
