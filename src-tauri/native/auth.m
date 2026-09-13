#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// Called only on a blocking worker: never block the webview/main event loop.
int opsportal_authenticate(void) {
    @autoreleasepool {
        LAContext *context = [[LAContext alloc] init];
        context.touchIDAuthenticationAllowableReuseDuration = 0;
        NSError *error = nil;
        if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error]) return 0;
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block BOOL authenticated = NO;
        [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
                localizedReason:@"Unlock your private infrastructure knowledge base"
                reply:^(BOOL success, NSError *replyError) {
                    (void)replyError;
                    authenticated = success;
                    dispatch_semaphore_signal(done);
                }];
        long timedOut = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC));
        [context invalidate];
        return timedOut == 0 && authenticated ? 1 : 0;
    }
}
