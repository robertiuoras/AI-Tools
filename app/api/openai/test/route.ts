import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY

    if (!openaiApiKey) {
      return NextResponse.json({
        error: 'No API key found',
        details: 'OPENAI_API_KEY or NEXT_PUBLIC_OPENAI_API_KEY not set in environment variables'
      }, { status: 400 })
    }

    // Test the API key with a simple request
    const testResponse = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    })

    if (!testResponse.ok) {
      const errorText = await testResponse.text()
      let errorDetails: any = {}
      try {
        errorDetails = JSON.parse(errorText)
      } catch (e) {
        // Not JSON
      }

      return NextResponse.json({
        error: `API key test failed: ${testResponse.status}`,
        details: errorDetails,
        message: errorText,
        status: testResponse.status,
        suggestion: testResponse.status === 401 
          ? 'API key is invalid. Check your OPENAI_API_KEY in environment variables.'
          : testResponse.status === 429
          ? 'Rate limited. Check your tier at https://platform.openai.com/account/limits'
          : 'Check your API key and account status at https://platform.openai.com/account'
      }, { status: testResponse.status })
    }

    const models = await testResponse.json()
    
    // Also check usage/limits
    const usageResponse = await fetch('https://api.openai.com/v1/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    })

    let usageInfo = null
    if (usageResponse.ok) {
      try {
        usageInfo = await usageResponse.json()
      } catch (e) {
        // Ignore
      }
    }

    return NextResponse.json({
      success: true,
      message: 'API key is valid',
      keyFormat: openaiApiKey.startsWith('sk-') ? 'valid' : 'invalid format',
      keyLength: openaiApiKey.length,
      modelsAvailable: models.data?.length || 0,
      usage: usageInfo,
      suggestion: 'If you\'re still getting 429 errors, check your RPM (requests per minute) limit at https://platform.openai.com/account/limits'
    })
  } catch (error: any) {
    return NextResponse.json({
      error: 'Error testing API key',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}

